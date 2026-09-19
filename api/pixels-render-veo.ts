/**
 * POST /api/pixels-render-veo — Gemini still + Veo 3.1 i2v for Creative Pixels render.
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
import {
  isFlowBillingEnforced,
  quoteFlowCreditsUsdc6,
  verifyFlowPayment,
} from './flow-billing.js'
import { isSeedanceGenerateEnabled } from './_seedance-pricing.js'
import {
  registerPixelsGenerateJob,
  updatePixelsGenerateJob,
} from './_pixels-generate-jobs.js'
import { failPixelsGenerateJob } from './_pixels-generate-payment.js'

const PIXELS_VEO_TIER: VeoTier = 'standard'
const PIXELS_STILL_QUALITY: NanobananaQuality = '2K'

async function stillToPublicUrl(
  prompt: string,
  requestUrl: string,
): Promise<string> {
  const image = await generateGeminiImage(prompt, { quality: PIXELS_STILL_QUALITY })
  const { storeFlowFrameFromDataUri } = await import('./flow-frame.js')
  const origin = new URL(requestUrl).origin
  const dataUri = `data:${image.mimeType};base64,${image.base64}`
  return storeFlowFrameFromDataUri(dataUri, origin)
}

export async function POST(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }
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

  const duration = clampFlowDuration(typeof body.duration === 'number' ? body.duration : 8)
  const quality = normalizeVeoQuality('720p', PIXELS_VEO_TIER)
  const aspectRatio = typeof body.aspect_ratio === 'string' ? body.aspect_ratio : '16:9'

  const totalCredits = quoteFlowTotalCredits({
    duration,
    quality: '720p',
    tier: PIXELS_VEO_TIER,
    stillCount: 1,
    stillQuality: PIXELS_STILL_QUALITY,
  })
  const quote = quoteFlowCreditsUsdc6(totalCredits)
  if (!quote) {
    return Response.json({ error: 'invalid quote' }, { status: 400 })
  }

  try {
    await registerPixelsGenerateJob({
      id: requestId,
      wallet: auth.address,
      provider: 'veo',
      status: 'processing',
      progress: 0,
      model: 'veo-3.1-generate-preview',
      costUsdc6: quote.estimatedUsdc6,
      crtvaiRequired: quote.minCrtvaiWei.toString(),
    })
  } catch (e) {
    console.error('pixels-render-veo job registration failed', e)
    return Response.json({ error: 'job registry unavailable' }, { status: 503 })
  }

  if (isFlowBillingEnforced()) {
    const paymentTxHash = typeof body.paymentTxHash === 'string' ? body.paymentTxHash.trim() : ''
    if (!paymentTxHash) {
      await failPixelsGenerateJob(requestId, {
        code: 'payment_required',
        message: 'Payment required',
        type: 'billing',
      }, { releasePayment: false })
      return Response.json({ error: 'payment_required' }, { status: 402 })
    }
    const verified = await verifyFlowPayment({
      txHash: paymentTxHash,
      from: auth.address,
      minAmountWei: quote.minCrtvaiWei,
      purpose: 'pixels-render-veo',
    })
    if (!verified.ok) {
      await failPixelsGenerateJob(requestId, {
        code: 'payment_failed',
        message: verified.reason,
        type: 'billing',
      }, { releasePayment: false })
      return Response.json({ error: verified.reason }, { status: 402 })
    }
    await updatePixelsGenerateJob(requestId, { paymentTxHash })
  } else {
    try {
      const balanceCheck = await checkMetokenSufficient(auth.address, quote.estimatedUsdc6)
      if (!balanceCheck.sufficient) {
        await failPixelsGenerateJob(requestId, {
          code: 'insufficient_crtvai',
          message: 'Insufficient CRTVAI balance',
          type: 'billing',
        }, { releasePayment: false })
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
      console.warn('pixels-render-veo balance check skipped', e)
    }
  }

  try {
    const startUrl = await stillToPublicUrl(prompt, request.url)
    const startImage = await fetchImageBytes(startUrl)

    const started = await startVeoVideo({
      tier: PIXELS_VEO_TIER,
      prompt,
      startImage,
      duration,
      quality,
      aspectRatio,
    })

    const taskId = shortTaskId(started.operationName)
    const { registerGenerativeTask } = await import('./_task-registry.js')
    await registerGenerativeTask(taskId, auth.address, {
      operationName: started.operationName,
      modelId: started.modelId,
    })

    await updatePixelsGenerateJob(requestId, {
      veoTaskId: taskId,
      model: started.modelId,
    })

    return Response.json({
      id: taskId,
      status: 'processing',
      progress: 0,
      model: started.modelId,
      startImageUrl: startUrl,
      costUsdc6: quote.estimatedUsdc6,
      crtvaiRequired: quote.minCrtvaiWei.toString(),
      stillCredits: quoteNanobananaCredits(PIXELS_STILL_QUALITY),
      pixelsRequestId: requestId,
    })
  } catch (e) {
    console.error('pixels-render-veo error', e)
    const message = e instanceof Error ? e.message : 'generation failed'
    await failPixelsGenerateJob(requestId, {
      code: 'generation_failed',
      message,
      type: 'vertex',
    })
    return Response.json(
      {
        id: requestId,
        status: 'failed',
        progress: 0,
        model: 'veo-3.1-generate-preview',
        error: {
          code: 'generation_failed',
          message,
          type: 'vertex',
        },
      },
      { status: 502 },
    )
  }
}
