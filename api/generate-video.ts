/**
 * POST /api/generate-video — Veo 3.1 i2v with CRTVAI payment verify.
 */
// fallow-ignore-file complexity,code-duplication

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { checkMetokenSufficient } from './_metoken-server.js'
import {
  clampFlowDuration,
  normalizeVeoQuality,
  quoteVeoCredits,
  type VeoTier,
} from './_generative-pricing.js'
import {
  fetchImageBytes,
  isVertexGenerativeConfigured,
  shortTaskId,
  startVeoVideo,
} from './_vertex-generative.js'
import { isFlowBillingEnforced, quoteFlowCreditsUsdc6, verifyFlowPayment } from './flow-billing.js'

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

function quoteVideoCredits(body: Record<string, unknown>): number {
  const duration = clampFlowDuration(typeof body.duration === 'number' ? body.duration : 8)
  const tier = parseTier(body)
  const quality = normalizeVeoQuality(
    typeof body.quality === 'string' ? body.quality : '720p',
    tier,
  )
  return quoteVeoCredits({ duration, quality, tier })
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
  const imageUrls = Array.isArray(body.image_urls)
    ? body.image_urls.filter((u) => typeof u === 'string')
    : []
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
    const tier = parseTier(body)
    const quality = normalizeVeoQuality(
      typeof body.quality === 'string' ? body.quality : '720p',
      tier,
    )
    const duration = clampFlowDuration(typeof body.duration === 'number' ? body.duration : 8)
    const startImage = await fetchImageBytes(String(imageUrls[0]))
    const endImage = imageUrls.length > 1 ? await fetchImageBytes(String(imageUrls[1])) : undefined

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
      costUsdc6: quote.estimatedUsdc6,
      crtvaiRequired: quote.minCrtvaiWei.toString(),
    })
  } catch (e) {
    console.error('generate-video vertex error', e)
    return Response.json({ error: 'generation failed' }, { status: 502 })
  }
}
