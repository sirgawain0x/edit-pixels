/**
 * POST /api/pixels-render-omni — Gemini Omni 1.2 Flash text-to-video for Creative Pixels render.
 */
// fallow-ignore-file complexity,code-duplication,duplicate-export

import {
  authenticateGenerativePost,
  verifyGenerativeCrtvaiPayment,
} from './_pixels-generate-route-auth.js'
import { checkMetokenSufficient } from './_metoken-server.js'
import {
  clampOmniDuration,
  GEMINI_OMNI_MODEL,
  normalizeOmniQuality,
  quoteOmniCredits,
} from './_generative-pricing.js'
import { isVertexGenerativeConfigured } from './_vertex-generative.js'
import { startOmniVideo } from './_vertex-omni.js'
import { quoteFlowCreditsUsdc6, isFlowBillingEnforced } from './flow-billing.js'
import {
  claimBatchShotForGenerate,
  completeBatchShotGenerate,
  getBatchShotGenerateParams,
  releaseDirectorBatchShotClaim,
  validateBatchGenerateAuthorization,
} from './_director-batch-generate.js'
import { isSeedanceGenerateEnabled } from './_seedance-pricing.js'
import { registerPixelsGenerateJob, updatePixelsGenerateJob } from './_pixels-generate-jobs.js'
import { failPixelsGenerateJob } from './_pixels-generate-payment.js'
import { checkPixelsRateLimits } from './_rate-limit.js'

export async function POST(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }
  if (!isVertexGenerativeConfigured()) {
    return Response.json({ error: 'service unavailable' }, { status: 503 })
  }

  const ipLimited = await checkPixelsRateLimits(request, 'render')
  if (ipLimited) return ipLimited

  const authenticated = await authenticateGenerativePost(request)
  if (!authenticated.ok) return authenticated.response
  const { signer, payer, body } = authenticated

  const identityLimited = await checkPixelsRateLimits(request, 'render', {
    ip: false,
    identity: signer,
  })
  if (identityLimited) return identityLimited

  const requestId =
    typeof body.requestId === 'string' && body.requestId.trim().length > 0
      ? body.requestId.trim()
      : null
  if (!requestId) {
    return Response.json({ error: 'requestId required' }, { status: 400 })
  }

  const batchConfirmId =
    typeof body.batchConfirmId === 'string'
      ? body.batchConfirmId.trim()
      : typeof body.batch_confirm_id === 'string'
        ? body.batch_confirm_id.trim()
        : ''
  const batchShotId =
    typeof body.shotId === 'string'
      ? body.shotId.trim()
      : typeof body.shot_id === 'string'
        ? body.shot_id.trim()
        : ''

  let prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  let duration = clampOmniDuration(typeof body.duration === 'number' ? body.duration : 8)
  let aspectRatio = typeof body.aspect_ratio === 'string' ? body.aspect_ratio : '16:9'
  let quality = normalizeOmniQuality(
    typeof body.quality === 'string'
      ? body.quality
      : typeof body.resolution === 'string'
        ? body.resolution
        : '720p',
  )
  let batchPaymentTxHash: string | null = null
  let skipBatchPaymentVerify = false
  const usingBatchConfirm = Boolean(batchConfirmId && batchShotId)

  if (usingBatchConfirm) {
    const batchParams = await getBatchShotGenerateParams({
      batchConfirmId,
      shotId: batchShotId,
    })
    if (!batchParams.ok || batchParams.params.provider !== 'omni') {
      return Response.json({ error: 'batch_confirm_mismatch' }, { status: 400 })
    }
    const batchAuth = await validateBatchGenerateAuthorization({
      batchConfirmId,
      shotId: batchShotId,
      requestId,
      wallet: signer,
    })
    if (!batchAuth.ok) {
      return Response.json({ error: batchAuth.error }, { status: 400 })
    }
    const batchShot = batchParams.params
    prompt = batchShot.prompt
    duration = clampOmniDuration(batchShot.omniDuration)
    aspectRatio = batchShot.aspect_ratio
    quality = '720p'
    batchPaymentTxHash = batchAuth.paymentTxHash
    skipBatchPaymentVerify = batchAuth.skipPaymentVerify
  }

  if (!prompt) {
    return Response.json({ error: 'prompt required' }, { status: 400 })
  }

  const totalCredits = quoteOmniCredits({ duration, quality })
  const quote = await quoteFlowCreditsUsdc6(totalCredits)
  if (!quote) {
    return Response.json({ error: 'invalid quote' }, { status: 400 })
  }

  try {
    await registerPixelsGenerateJob({
      id: requestId,
      wallet: signer,
      provider: 'omni',
      status: 'processing',
      progress: 0,
      model: GEMINI_OMNI_MODEL,
      costUsdc6: quote.estimatedUsdc6,
      crtvaiRequired: quote.minCrtvaiWei.toString(),
    })
  } catch (e) {
    console.error('pixels-render-omni job registration failed', e)
    return Response.json({ error: 'job registry unavailable' }, { status: 503 })
  }

  if (isFlowBillingEnforced()) {
    if (skipBatchPaymentVerify && batchPaymentTxHash) {
      await updatePixelsGenerateJob(requestId, { paymentTxHash: batchPaymentTxHash })
    } else {
      const paymentTxHash = typeof body.paymentTxHash === 'string' ? body.paymentTxHash.trim() : ''
      if (!paymentTxHash) {
        await failPixelsGenerateJob(
          requestId,
          {
            code: 'payment_required',
            message: 'Payment required',
            type: 'billing',
          },
          { releasePayment: false },
        )
        return Response.json({ error: 'payment_required' }, { status: 402 })
      }
      const verified = await verifyGenerativeCrtvaiPayment({
        paymentTxHash,
        signer,
        payer,
        quote,
        purpose: 'pixels-render-omni',
      })
      if (!verified.ok) {
        await failPixelsGenerateJob(
          requestId,
          {
            code: 'payment_failed',
            message: verified.reason,
            type: 'billing',
          },
          { releasePayment: false },
        )
        return Response.json({ error: verified.reason }, { status: 402 })
      }
      await updatePixelsGenerateJob(requestId, {
        paymentTxHash,
        paymentLogIndex: verified.logIndex,
      })
    }
  } else {
    try {
      const balanceCheck = await checkMetokenSufficient(payer, quote.estimatedUsdc6)
      if (!balanceCheck.sufficient) {
        await failPixelsGenerateJob(
          requestId,
          {
            code: 'insufficient_crtvai',
            message: 'Insufficient CRTVAI balance',
            type: 'billing',
          },
          { releasePayment: false },
        )
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
      console.warn('pixels-render-omni balance check skipped', e)
    }
  }

  if (usingBatchConfirm) {
    const claimed = await claimBatchShotForGenerate({
      batchConfirmId,
      shotId: batchShotId,
      requestId,
    })
    if (!claimed.ok) {
      await failPixelsGenerateJob(
        requestId,
        {
          code: claimed.error,
          message: 'Batch shot already started',
          type: 'billing',
        },
        { releasePayment: false },
      )
      return Response.json({ error: claimed.error }, { status: 409 })
    }
  }

  try {
    const started = await startOmniVideo({
      prompt,
      duration,
      quality,
      aspectRatio,
    })

    const taskId = started.interactionId
    const { registerGenerativeTask } = await import('./_task-registry.js')
    await registerGenerativeTask(taskId, signer, {
      operationName: started.interactionId,
      interactionId: started.interactionId,
      modelId: started.modelId,
      kind: 'omni',
    })

    await updatePixelsGenerateJob(requestId, {
      veoTaskId: taskId,
      model: started.modelId,
    })

    if (usingBatchConfirm) {
      await completeBatchShotGenerate({ batchConfirmId, shotId: batchShotId })
    }

    return Response.json({
      id: taskId,
      status: 'processing',
      progress: 0,
      model: started.modelId,
      costUsdc6: quote.estimatedUsdc6,
      crtvaiRequired: quote.minCrtvaiWei.toString(),
      stillCredits: 0,
      pixelsRequestId: requestId,
    })
  } catch (e) {
    if (usingBatchConfirm) {
      await releaseDirectorBatchShotClaim(batchConfirmId, batchShotId)
    }
    console.error('pixels-render-omni error', e)
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
        model: GEMINI_OMNI_MODEL,
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
