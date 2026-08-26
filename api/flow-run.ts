/**
 * POST /api/flow-run — one CRTVAI payment covers optional Gemini stills + Seedance i2v.
 *
 * Body:
 *  prompt, duration?, quality?, speed?, aspect_ratio?, generate_audio?,
 *  startImageUrl?, endImageUrl?,
 *  startPrompt?, endPrompt?, stillQuality?,
 *  paymentTxHash?, walletAddress, requestId, token?
 */

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { checkMetokenSufficient } from './_metoken-server.js'
import {
  evolinkServerGet,
  evolinkServerPost,
  isEvolinkServerConfigured,
} from './_evolink-server.js'
import { isFlowBillingEnforced, quoteFlowCreditsUsdc6, verifyFlowPayment } from './flow-billing.js'

function videoCredits(body: Record<string, unknown>): number {
  const duration = typeof body.duration === 'number' ? body.duration : 5
  const quality = typeof body.quality === 'string' ? body.quality : '720p'
  const speed = typeof body.speed === 'string' ? body.speed : 'standard'
  const generateAudio = body.generate_audio !== false
  const qMult = quality === '1080p' ? 2.5 : quality === '720p' ? 1.6 : 1
  const sMult = speed === 'fast' ? 0.75 : 1
  let credits = duration * 1.4 * qMult * sMult
  if (generateAudio) credits *= 1.15
  return Math.max(1, Math.ceil(credits))
}

function stillCredits(quality: string): number {
  const map: Record<string, number> = { '0.5K': 5, '1K': 8, '2K': 12, '4K': 18 }
  return map[quality] ?? 10
}

async function waitImageUrl(taskId: string): Promise<string> {
  // Cap ~90s per still (60 × 1.5s). Dual stills run in parallel so wall clock ≈ one still.
  for (let i = 0; i < 60; i++) {
    const detail = await evolinkServerGet<{
      status: string
      output?: { image_url?: string; image_urls?: string[] }
      error?: { message?: string }
    }>(`/tasks/${taskId}`)
    if (detail.status === 'completed') {
      const url = detail.output?.image_url || detail.output?.image_urls?.[0]
      if (!url) throw new Error('Image task completed without URL')
      return url
    }
    if (detail.status === 'failed') {
      throw new Error(detail.error?.message || 'Image generation failed')
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error('Image generation timed out')
}

async function resolveHttpsImageUrl(url: string, requestUrl: string): Promise<string> {
  const trimmed = url.trim()
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed
  if (!trimmed.startsWith('data:')) {
    throw new Error('Image URLs must be https or data URIs')
  }
  // Persist data URI via flow-frame so Evolink can fetch over HTTPS.
  const { storeFlowFrameFromDataUri } = await import('./flow-frame.js')
  const origin = new URL(requestUrl).origin
  return storeFlowFrameFromDataUri(trimmed, origin)
}

// fallow-ignore-next-line complexity
export async function POST(request: Request): Promise<Response> {
  if (!isEvolinkServerConfigured()) {
    return Response.json({ error: 'service unavailable' }, { status: 503 })
  }

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return Response.json({ error: 'invalid body' }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const token = getBearerToken(request) || (typeof body.token === 'string' ? body.token : null)
  if (!token) {
    return Response.json({ error: 'missing authorization' }, { status: 401 })
  }

  const auth = await verifyPrivyAccessToken(
    token,
    typeof body.walletAddress === 'string' ? body.walletAddress : undefined,
  )
  if (!auth) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 })
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) {
    return Response.json({ error: 'prompt required' }, { status: 400 })
  }

  const requestId =
    typeof body.requestId === 'string' && body.requestId.trim().length > 0
      ? body.requestId.trim()
      : null
  if (!requestId) {
    return Response.json({ error: 'requestId required' }, { status: 400 })
  }

  let startUrl = typeof body.startImageUrl === 'string' ? body.startImageUrl.trim() : ''
  let endUrl = typeof body.endImageUrl === 'string' ? body.endImageUrl.trim() : ''
  const startPrompt = typeof body.startPrompt === 'string' ? body.startPrompt.trim() : ''
  const endPrompt = typeof body.endPrompt === 'string' ? body.endPrompt.trim() : ''
  const stillQuality = typeof body.stillQuality === 'string' ? body.stillQuality : '2K'

  const needStartStill = !startUrl && Boolean(startPrompt)
  const needEndStill = !endUrl && Boolean(endPrompt)
  if (!startUrl && !startPrompt) {
    return Response.json({ error: 'start image or startPrompt required' }, { status: 400 })
  }
  if (!endUrl && !endPrompt) {
    return Response.json({ error: 'end image or endPrompt required' }, { status: 400 })
  }

  const stillCount = (needStartStill ? 1 : 0) + (needEndStill ? 1 : 0)
  const totalCredits = videoCredits(body) + stillCount * stillCredits(stillQuality)
  const quote = quoteFlowCreditsUsdc6(totalCredits)
  if (!quote) {
    return Response.json({ error: 'invalid quote' }, { status: 400 })
  }

  if (isFlowBillingEnforced()) {
    const paymentTxHash = typeof body.paymentTxHash === 'string' ? body.paymentTxHash.trim() : ''
    if (!paymentTxHash) {
      return Response.json({ error: 'payment_required' }, { status: 402 })
    }
    const verified = await verifyFlowPayment({
      txHash: paymentTxHash,
      from: auth.address,
      minAmountWei: quote.minCrtvaiWei,
      purpose: 'flow-run',
    })
    if (!verified.ok) {
      return Response.json({ error: verified.reason }, { status: 402 })
    }
  } else {
    try {
      const balanceCheck = await checkMetokenSufficient(auth.address, quote.estimatedUsdc6)
      if (!balanceCheck.sufficient) {
        return Response.json(
          {
            error: 'insufficient_crtvai',
            costUsdc6: quote.estimatedUsdc6,
            requiredMetoken: balanceCheck.requiredMetoken.toString(),
          },
          { status: 402 },
        )
      }
    } catch (e) {
      console.error('flow-run balance check failed', e)
      return Response.json({ error: 'failed to verify balance' }, { status: 502 })
    }
  }

  try {
    const stillJobs: Promise<void>[] = []
    if (needStartStill) {
      stillJobs.push(
        (async () => {
          const img = await evolinkServerPost<{ id: string }>('/images/generations', {
            model: 'gemini-3.1-flash-image-preview',
            prompt: startPrompt,
            size: 'auto',
            quality: stillQuality,
          })
          startUrl = await waitImageUrl(img.id)
        })(),
      )
    }
    if (needEndStill) {
      stillJobs.push(
        (async () => {
          const img = await evolinkServerPost<{ id: string }>('/images/generations', {
            model: 'gemini-3.1-flash-image-preview',
            prompt: endPrompt,
            size: 'auto',
            quality: stillQuality,
          })
          endUrl = await waitImageUrl(img.id)
        })(),
      )
    }
    await Promise.all(stillJobs)

    startUrl = await resolveHttpsImageUrl(startUrl, request.url)
    endUrl = await resolveHttpsImageUrl(endUrl, request.url)

    const model =
      body.speed === 'fast' ? 'seedance-2.0-fast-image-to-video' : 'seedance-2.0-image-to-video'

    const result = await evolinkServerPost<Record<string, unknown> & { id?: string }>(
      '/videos/generations',
      {
        model,
        prompt,
        image_urls: [startUrl, endUrl],
        duration: body.duration ?? 5,
        quality: body.quality ?? '720p',
        aspect_ratio: body.aspect_ratio ?? 'adaptive',
        generate_audio: body.generate_audio ?? true,
      },
    )

    if (typeof result.id === 'string') {
      const { registerGenerativeTask } = await import('./_task-registry.js')
      await registerGenerativeTask(result.id, auth.address)
    }

    return Response.json({
      ...result,
      startImageUrl: startUrl,
      endImageUrl: endUrl,
      costUsdc6: quote.estimatedUsdc6,
      crtvaiRequired: quote.minCrtvaiWei.toString(),
    })
  } catch (e) {
    console.error('flow-run error', e)
    return Response.json(
      { error: e instanceof Error ? e.message : 'generation failed' },
      { status: 502 },
    )
  }
}
