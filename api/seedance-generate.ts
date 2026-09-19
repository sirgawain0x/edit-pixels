/**
 * POST /api/seedance-generate — CRTVAI-gated Higgsfield Seedance 2.5 text-to-video.
 */
// fallow-ignore-file complexity,code-duplication

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { checkMetokenSufficient } from './_metoken-server.js'
import { bindSeedanceQuote } from './_pixels-generate-billing-core.js'
import {
  getSeedanceQuote,
  isSeedanceBillingEnforced,
  reserveSeedanceSpend,
  settleSeedanceSpend,
  verifySeedancePayment,
} from './_seedance-billing.js'
import { generateSeedanceVideo, isHiggsfieldConfigured } from './_higgsfield-seedance.js'
import {
  registerPixelsGenerateJob,
  updatePixelsGenerateJob,
} from './_pixels-generate-jobs.js'
import { failPixelsGenerateJob } from './_pixels-generate-payment.js'
import {
  clampSeedanceDuration,
  isSeedanceGenerateEnabled,
  type SeedanceAspectRatio,
  type SeedanceResolution,
} from './_seedance-pricing.js'

const SEEDANCE_MODEL = 'bytedance/seedance-2.5/text-to-video'

export async function POST(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }
  if (!isHiggsfieldConfigured()) {
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

  const duration = clampSeedanceDuration(typeof body.duration === 'number' ? body.duration : 5)
  const resolution: SeedanceResolution = body.resolution === '480p' ? '480p' : '720p'
  const aspect_ratio = (typeof body.aspect_ratio === 'string'
    ? body.aspect_ratio
    : '16:9') as SeedanceAspectRatio
  const generate_audio = body.generate_audio !== false

  const quoteId = typeof body.quoteId === 'string' ? body.quoteId.trim() : ''
  const storedQuote = quoteId ? await getSeedanceQuote(quoteId) : null
  const bound = bindSeedanceQuote(quoteId, storedQuote, duration, resolution)
  if (!bound.ok || !storedQuote) {
    return Response.json({ error: 'quote_mismatch' }, { status: 400 })
  }
  const quote = storedQuote

  await registerPixelsGenerateJob({
    id: requestId,
    wallet: auth.address,
    provider: 'seedance',
    status: 'processing',
    progress: 0,
    model: SEEDANCE_MODEL,
    costUsdc6: quote.estimatedUsdc6,
    crtvaiRequired: quote.minCrtvaiWei.toString(),
  })

  const reservation = await reserveSeedanceSpend(quote.quoteId, auth.address)

  if (isSeedanceBillingEnforced()) {
    const paymentTxHash = typeof body.paymentTxHash === 'string' ? body.paymentTxHash.trim() : ''
    if (!paymentTxHash) {
      await failPixelsGenerateJob(requestId, {
        code: 'payment_required',
        message: 'Payment required',
        type: 'billing',
      }, { releasePayment: false })
      return Response.json({ error: 'payment_required' }, { status: 402 })
    }
    const verified = await verifySeedancePayment({
      txHash: paymentTxHash,
      from: auth.address,
      minAmountWei: quote.minCrtvaiWei,
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
      console.warn('seedance-generate balance check skipped', e)
    }
  }

  try {
    const result = await generateSeedanceVideo({
      prompt,
      duration,
      resolution,
      aspect_ratio,
      generate_audio,
    })

    if (reservation) {
      await settleSeedanceSpend(reservation.reservationId)
    }

    await updatePixelsGenerateJob(requestId, {
      status: 'completed',
      progress: 100,
      output: { video_url: result.videoUrl },
      mock: result.mock,
    })

    return Response.json({
      id: requestId,
      status: 'completed',
      progress: 100,
      model: SEEDANCE_MODEL,
      output: { video_url: result.videoUrl },
      requestId: result.requestId,
      mock: result.mock,
      costUsdc6: quote.estimatedUsdc6,
      crtvaiRequired: quote.minCrtvaiWei.toString(),
    })
  } catch (e) {
    console.error('seedance-generate error', e)
    const message = e instanceof Error ? e.message : 'Generation failed'
    await failPixelsGenerateJob(requestId, {
      code: 'generation_failed',
      message,
      type: 'higgsfield',
    })
    return Response.json(
      {
        id: requestId,
        status: 'failed',
        progress: 0,
        model: SEEDANCE_MODEL,
        error: {
          code: 'generation_failed',
          message,
          type: 'higgsfield',
        },
      },
      { status: 502 },
    )
  }
}
