/**
 * POST /api/flow-run — one CRTVAI payment covers optional Gemini stills + Veo 3.1 i2v.
 */
// fallow-ignore-file complexity,code-duplication

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { checkMetokenSufficient } from './_metoken-server.js'
import {
  clampFlowDuration,
  normalizeVeoQuality,
  quoteFlowTotalCredits,
  quoteNanobananaCredits,
  type NanobananaQuality,
  type VeoTier,
} from './_generative-pricing.js'
import {
  fetchImageBytes,
  generateGeminiImage,
  isVertexGenerativeConfigured,
  shortTaskId,
  startVeoVideo,
} from './_vertex-generative.js'
import { isFlowBillingEnforced, quoteFlowCreditsUsdc6, verifyFlowPayment } from './flow-billing.js'

async function resolveHttpsImageUrl(url: string, requestUrl: string): Promise<string> {
  const trimmed = url.trim()
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed
  if (!trimmed.startsWith('data:')) {
    throw new Error('Image URLs must be https or data URIs')
  }
  const { storeFlowFrameFromDataUri } = await import('./flow-frame.js')
  const origin = new URL(requestUrl).origin
  return storeFlowFrameFromDataUri(trimmed, origin)
}

async function stillToPublicUrl(
  prompt: string,
  stillQuality: NanobananaQuality,
  requestUrl: string,
): Promise<string> {
  const image = await generateGeminiImage(prompt, { quality: stillQuality })
  const { storeFlowFrameFromDataUri } = await import('./flow-frame.js')
  const origin = new URL(requestUrl).origin
  const dataUri = `data:${image.mimeType};base64,${image.base64}`
  return storeFlowFrameFromDataUri(dataUri, origin)
}

function parseTier(body: Record<string, unknown>): VeoTier {
  const raw =
    typeof body.tier === 'string'
      ? body.tier
      : typeof body.speed === 'string'
        ? body.speed
        : 'standard'
  if (raw === 'fast' || raw === 'lite') return raw
  return 'standard'
}

// fallow-ignore-next-line complexity
export async function POST(request: Request): Promise<Response> {
  if (!isVertexGenerativeConfigured()) {
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
  const stillQuality = (
    typeof body.stillQuality === 'string' ? body.stillQuality : '2K'
  ) as NanobananaQuality
  const tier = parseTier(body)
  const qualityRaw = typeof body.quality === 'string' ? body.quality : '720p'
  const quality = normalizeVeoQuality(qualityRaw, tier)
  const duration = clampFlowDuration(typeof body.duration === 'number' ? body.duration : 8)

  const needStartStill = !startUrl && Boolean(startPrompt)
  const needEndStill = !endUrl && Boolean(endPrompt)
  if (!startUrl && !startPrompt) {
    return Response.json({ error: 'start image or startPrompt required' }, { status: 400 })
  }
  if (!endUrl && !endPrompt) {
    return Response.json({ error: 'end image or endPrompt required' }, { status: 400 })
  }

  const stillCount = (needStartStill ? 1 : 0) + (needEndStill ? 1 : 0)
  const totalCredits = quoteFlowTotalCredits({
    duration,
    quality: qualityRaw,
    tier,
    stillCount,
    stillQuality,
  })
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
    if (needStartStill) {
      startUrl = await stillToPublicUrl(startPrompt, stillQuality, request.url)
    }
    if (needEndStill) {
      endUrl = await stillToPublicUrl(endPrompt, stillQuality, request.url)
    }

    startUrl = await resolveHttpsImageUrl(startUrl, request.url)
    endUrl = await resolveHttpsImageUrl(endUrl, request.url)

    const startImage = await fetchImageBytes(startUrl)
    const endImage = await fetchImageBytes(endUrl)

    const started = await startVeoVideo({
      tier,
      prompt,
      startImage,
      endImage,
      duration,
      quality,
      aspectRatio: typeof body.aspect_ratio === 'string' ? body.aspect_ratio : '16:9',
    })

    const taskId = shortTaskId(started.operationName)
    const { registerGenerativeTask } = await import('./_task-registry.js')
    await registerGenerativeTask(taskId, auth.address, {
      operationName: started.operationName,
      modelId: started.modelId,
    })

    return Response.json({
      id: taskId,
      status: 'processing',
      progress: 0,
      model: started.modelId,
      startImageUrl: startUrl,
      endImageUrl: endUrl,
      costUsdc6: quote.estimatedUsdc6,
      crtvaiRequired: quote.minCrtvaiWei.toString(),
      stillCredits: stillCount * quoteNanobananaCredits(stillQuality),
    })
  } catch (e) {
    console.error('flow-run error', e)
    return Response.json(
      { error: e instanceof Error ? e.message : 'generation failed' },
      { status: 502 },
    )
  }
}
