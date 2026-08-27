/**
 * POST /api/generate-video — Seedance i2v with Director-style CRTVAI payment verify.
 *
 * Body: prompt, image_urls (1–2), duration?, quality?, speed?, aspect_ratio?,
 *       generate_audio?, requestId, walletAddress, paymentTxHash?
 * Header: Authorization: Bearer <privy token>
 */
// fallow-ignore-file complexity,code-duplication

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { checkMetokenSufficient } from './_metoken-server.js'
import { evolinkServerPost, isEvolinkServerConfigured } from './_evolink-server.js'
import { isFlowBillingEnforced, quoteFlowCreditsUsdc6, verifyFlowPayment } from './flow-billing.js'

function quoteVideoCredits(body: Record<string, unknown>): number {
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
  const imageUrls = Array.isArray(body.image_urls) ? body.image_urls : []
  if (!prompt || imageUrls.length === 0 || imageUrls.length > 2) {
    return Response.json({ error: 'prompt and 1–2 image_urls required' }, { status: 400 })
  }

  const requestId =
    typeof body.requestId === 'string' && body.requestId.trim().length > 0
      ? body.requestId.trim()
      : null
  if (!requestId) {
    return Response.json({ error: 'requestId required' }, { status: 400 })
  }

  const credits = quoteVideoCredits(body)
  const quote = quoteFlowCreditsUsdc6(credits)
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
      purpose: 'generate-video',
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
            balance: balanceCheck.balance.toString(),
            requiredMetoken: balanceCheck.requiredMetoken.toString(),
            costUsdc6: quote.estimatedUsdc6,
          },
          { status: 402 },
        )
      }
    } catch (e) {
      console.error('Failed to check meToken balance', e)
      return Response.json({ error: 'failed to verify balance' }, { status: 502 })
    }
  }

  try {
    const model =
      body.speed === 'fast' ? 'seedance-2.0-fast-image-to-video' : 'seedance-2.0-image-to-video'

    const result = await evolinkServerPost<Record<string, unknown> & { id?: string }>(
      '/videos/generations',
      {
        model,
        prompt,
        image_urls: imageUrls,
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
      costUsdc6: quote.estimatedUsdc6,
      crtvaiRequired: quote.minCrtvaiWei.toString(),
    })
  } catch (e) {
    console.error('generate-video evolink error', e)
    return Response.json({ error: 'generation failed' }, { status: 502 })
  }
}
