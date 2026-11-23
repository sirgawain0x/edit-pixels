/**
 * POST /api/transcribe-precision
 *
 * 1. Authenticates the user.
 * 2. Validates the client-side plan (source duration ceiling, sub-file clamp, overlap).
 * 3. Creates the `transcription_jobs` record *before* any payment.
 * 4. If the price is zero, returns `{ free: true }`.
 * 5. Otherwise mints a CRTVAI quote and returns it.
 * 6. Does NOT submit to Google yet — payment verification happens client-side
 *    and a follow-up internal path submits the batch after the quote is paid.
 */
// fallow-ignore-file complexity

import { randomUUID } from 'node:crypto'
import { authenticateGenerativePost } from './_pixels-generate-route-auth.js'
import { quoteCrtvaiForUsdc6 } from './_metoken-curve-quote.js'
import { checkPixelsRateLimits } from './_rate-limit.js'
import {
  TRANSCRIPTION_MAX_AUDIO_MINUTES,
  TRANSCRIPTION_RUN_CAP_USDC6,
  TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE,
} from './_transcription-pricing.js'
import {
  attachQuoteToTranscriptionJob,
  countFreeRunsThisMonth,
  createQuotedTranscriptionJob,
  markTranscriptionJobFailed,
  transcriptionMonthKey,
  type StartTranscriptionPrecisionRequest,
  type StartTranscriptionPrecisionResponse,
} from './_transcription-jobs.js'

const MAX_SUB_SEC = 1199.5
const FREE_RUNS_MONTHLY = 5
const FREE_MINUTES = 10
const QUOTE_EXPIRY_MS = 75_000
const SETTLEMENT_GRACE_MS = 825_000

interface PricedRun {
  usdc6: number
  free: boolean
  freeRunMonth: string | null
}

function estimateUsdc6(
  sourceMinutes: number,
  freeRunsUsed: number,
): { usdc6: number; free: boolean } {
  if (sourceMinutes <= FREE_MINUTES && freeRunsUsed < FREE_RUNS_MONTHLY) {
    return { usdc6: 0, free: true }
  }
  const raw = sourceMinutes * TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE
  const capped = Math.min(raw, TRANSCRIPTION_RUN_CAP_USDC6)
  return { usdc6: capped, free: false }
}

function isValidPlan(
  plan: StartTranscriptionPrecisionRequest['plan'],
  sourceDurationSec: number,
): boolean {
  const submittedCeil = plan.reduce((sum, p) => sum + Math.ceil(p.endSec - p.startSec), 0)
  // Guard against a plan that magically exceeds source duration by more than rounding + overlap.
  if (submittedCeil > Math.ceil(sourceDurationSec) + 60) return false
  return plan.every((p) => {
    const dur = p.endSec - p.startSec
    return dur > 0 && dur <= MAX_SUB_SEC && p.overlapSec >= 0 && p.vadSpeechSeconds >= 0
  })
}

/**
 * The rejection this request deserves, or null when it is well formed. Ordered
 * coarse-to-fine so the client gets the actionable reason: shape, then the
 * source ceiling, then the plan itself.
 */
function planRejection(req: StartTranscriptionPrecisionRequest): string | null {
  if (!req.mediaId || typeof req.sourceDurationSec !== 'number' || !Array.isArray(req.plan)) {
    return 'invalid request'
  }
  // Product ceiling is on source duration; price/cap are on submitted seconds.
  if (req.sourceDurationSec / 60 > TRANSCRIPTION_MAX_AUDIO_MINUTES) return 'over hard cap'
  if (!isValidPlan(req.plan, req.sourceDurationSec)) return 'invalid plan'
  return null
}

/** Seconds Google will bill for: the sum of the real cut durations, rounded up once. */
function submittedSecondsCeilOf(plan: StartTranscriptionPrecisionRequest['plan']): number {
  return Math.ceil(plan.reduce((sum, p) => sum + (p.endSec - p.startSec), 0))
}

/** Price the run, spending one free short-run allowance when the account still has any. */
async function priceRun(input: {
  accountId: string
  sourceDurationSec: number
  quoteCreatedAtMs: number
}): Promise<PricedRun> {
  const monthKey = transcriptionMonthKey(input.quoteCreatedAtMs)
  const freeRunsUsed = await countFreeRunsThisMonth({
    accountId: input.accountId,
    monthKey,
    cap: FREE_RUNS_MONTHLY,
  })
  const { usdc6, free } = estimateUsdc6(input.sourceDurationSec / 60, freeRunsUsed)
  return { usdc6, free, freeRunMonth: free ? monthKey : null }
}

async function startJob(input: {
  accountId: string
  req: StartTranscriptionPrecisionRequest
  priced: PricedRun
  quoteCreatedAtMs: number
  settleByMs: number
}): Promise<{ jobId: string; created: boolean }> {
  const jobId = randomUUID()
  const created = await createQuotedTranscriptionJob({
    jobId,
    accountId: input.accountId,
    mediaId: input.req.mediaId,
    estimatedUsdc6: input.priced.usdc6,
    submittedSecondsCeil: submittedSecondsCeilOf(input.req.plan),
    plannedParts: input.req.plan.length,
    quoteCreatedAtMs: input.quoteCreatedAtMs,
    settleByMs: input.settleByMs,
    freeRunMonth: input.priced.freeRunMonth,
  })
  return { jobId, created }
}

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authenticateGenerativePost(request)
  if (!authenticated.ok) return authenticated.response
  const { body, signer } = authenticated

  const identityLimited = await checkPixelsRateLimits(request, 'transcribe', {
    ip: false,
    identity: signer,
  })
  if (identityLimited) return identityLimited

  const req = body as unknown as StartTranscriptionPrecisionRequest
  const rejection = planRejection(req)
  if (rejection) return Response.json({ error: rejection }, { status: 400 })

  const accountId = signer.toLowerCase()
  const quoteCreatedAtMs = Date.now()
  const settleByMs = quoteCreatedAtMs + QUOTE_EXPIRY_MS + SETTLEMENT_GRACE_MS
  const priced = await priceRun({
    accountId,
    sourceDurationSec: req.sourceDurationSec,
    quoteCreatedAtMs,
  })

  const { jobId, created } = await startJob({
    accountId,
    req,
    priced,
    quoteCreatedAtMs,
    settleByMs,
  })
  if (!created) {
    console.error('transcription_jobs record write failed', {
      jobId,
      accountId,
      free: priced.free,
    })
  }

  if (priced.free) {
    // A free run is only safe to grant once its record landed: the record is the
    // free-run counter, so granting without it hands out unlimited free audio.
    if (!created) {
      return Response.json({ error: 'ledger_unavailable' }, { status: 503 })
    }
    const response: StartTranscriptionPrecisionResponse = { jobId, free: true }
    return Response.json(response)
  }

  try {
    const quote = await quoteCrtvaiForUsdc6(priced.usdc6, { tier: 'transcribe', quoteId: jobId })

    const attached = await attachQuoteToTranscriptionJob({
      jobId,
      quoteId: quote.quoteId,
      minCrtvaiWei: quote.minCrtvaiWei.toString(),
      expiresAtMs: quote.expiresAtMs,
    })
    if (!attached) {
      console.error('transcription_jobs quote attach failed', { jobId, quoteId: quote.quoteId })
    }

    const response: StartTranscriptionPrecisionResponse = {
      jobId,
      quote: {
        quoteId: quote.quoteId,
        estimatedUsdc6: quote.estimatedUsdc6,
        minCrtvaiWei: quote.minCrtvaiWei.toString(),
        expiresAtMs: quote.expiresAtMs,
      },
      free: false,
    }
    return Response.json(response)
  } catch (error) {
    // No quote means this job can never be paid; mark it so it does not read as in flight.
    await markTranscriptionJobFailed(jobId).catch(() => false)
    if (error instanceof Error && 'code' in error && error.code === 'quote_unpayable') {
      return Response.json({ error: 'quote_unpayable', message: error.message }, { status: 400 })
    }
    throw error
  }
}
