/**
 * Per-chunk cost accumulator for the cloud ("precision") transcription tier.
 *
 * Two sources of truth, deliberately:
 *  - a successful chunk returns `usage.cost` when the provider reports it, and
 *    that number already contains any billing-granularity rounding;
 *  - a failed/aborted chunk returns no usage at all, so its cost has to be
 *    estimated from what we sent, rounded up to the provider's billing grid.
 *
 * Mixing the two naively is how margin silently leaks: buffering against
 * audio-seconds arithmetic while relying on `usage.cost` means the buffer and
 * the rounding overhead are fighting over the same 15%.
 *
 * All amounts are integer usdc6 (USDC with 6 decimals), matching
 * `headless/lib/billing/ledger.mjs` and `pricing.mjs`.
 */

import { createHash } from 'node:crypto'

/** Prime Intellect's list rate for nvidia/nemotron-3.5-transcribe: $0.000017/sec. */
export const TRANSCRIPTION_RATE_USDC6_PER_SEC = 17

/** Google Chirp 3, dynamic batch: $0.003/min = $0.18/audio-hour = 50 usdc6/sec. */
export const CHIRP3_BATCH_RATE_USDC6_PER_SEC = 50

/** Google Chirp 3, standard (synchronous): $0.016/min = $0.96/audio-hour = 267 usdc6/sec. */
export const CHIRP3_STANDARD_RATE_USDC6_PER_SEC = 267

/**
 * BatchRecognize rejects any single audio file over 20 minutes, so a sub-file is
 * at most this long. Used for retry accounting: one rebuild costs one sub-file.
 */
export const CHIRP3_MAX_SUBFILE_SECONDS = 1200

/**
 * Summarize the audio a batch will actually submit, and enforce the per-file wall.
 *
 * BatchRecognize bills the exact submitted duration and rejects anything over
 * 1200.000s (inclusive at exactly 1200). This one function is the source of truth
 * for BOTH the quote and the 1200s check, so the price and the wall cannot be
 * measured on different clocks — the failure mode where a job planned to fit
 * under the ceiling gets priced on source minutes and rejected on submitted ones.
 *
 * Pass the plan's real cut durations. Do not pad: padding adds billable seconds
 * and creates the very rejections it was meant to avoid.
 *
 * @param {number[]} subfileDurationsSeconds
 * @param {number} [maxSecondsPerFile]
 */
export function summarizeSubmittedAudio(
  subfileDurationsSeconds,
  maxSecondsPerFile = CHIRP3_MAX_SUBFILE_SECONDS,
) {
  const durations = (Array.isArray(subfileDurationsSeconds) ? subfileDurationsSeconds : [])
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0)
  const totalSeconds = durations.reduce((sum, value) => sum + value, 0)
  return {
    parts: durations.length,
    totalSeconds,
    totalMinutes: totalSeconds / 60,
    /** Indices that would be rejected upstream. Empty means the plan is submittable. */
    overLimit: durations.reduce((bad, value, index) => (value > maxSecondsPerFile ? [...bad, index] : bad), []),
  }
}

/**
 * Reconcile the quote against what Google actually billed.
 *
 * Chirp reports `totalBilledDuration` on the operation plus per-file metadata, so
 * `cogsUsdc6` is measured rather than computed. Four verdicts matter, and three of
 * them are the zero-vs-absent trap wearing different clothes:
 *
 *  - a part with `metadata: null` is FAILED, never zero-cost and never delivered;
 *  - a top-level `0s` with submitted audio is a submit failure, not a free job;
 *  - drift is one-sided: measured can only exceed our ceil'd estimate, so a
 *    negative drift means we planned the job wrong, not that we got a discount.
 *
 * The identity `sum(parts) === total` is a free integrity check and the only thing
 * that catches a dropped or double-counted part, which is otherwise invisible.
 *
 * @param {object} options
 * @param {number} options.submittedSecondsCeil - what we priced, per-request ceil'd
 * @param {number} [options.expectedSubmittedSeconds] - raw planned audio
 * @param {number|null} [options.measuredTotalSeconds] - operation totalBilledDuration
 * @param {Array<number|null>} [options.measuredPartSeconds] - per-file billed seconds
 */
export function reconcileBilledSeconds({
  submittedSecondsCeil,
  expectedSubmittedSeconds = 0,
  measuredTotalSeconds = null,
  measuredPartSeconds = null,
}) {
  const priced = Math.max(0, Number(submittedSecondsCeil) || 0)
  const expected = Math.max(0, Number(expectedSubmittedSeconds) || 0)
  const parts = Array.isArray(measuredPartSeconds) ? measuredPartSeconds : null
  const failedParts = parts
    ? parts.reduce((bad, value, index) => (value == null ? [...bad, index] : bad), [])
    : []

  if (measuredTotalSeconds == null) {
    return { verdict: 'missing-billing', driftSeconds: null, failedParts, identityOk: null }
  }

  const measured = Math.max(0, Number(measuredTotalSeconds) || 0)

  if (measured === 0 && expected > 0) {
    return { verdict: 'submit-failure', driftSeconds: null, failedParts, identityOk: null }
  }

  const identityOk = parts
    ? parts.reduce((sum, value) => sum + (value == null ? 0 : Math.max(0, Number(value) || 0)), 0) === measured
    : null

  const driftSeconds = measured - priced
  let verdict = 'exact'
  if (identityOk === false) verdict = 'integrity-mismatch'
  else if (failedParts.length > 0) verdict = 'failed-parts'
  else if (driftSeconds < 0) verdict = 'plan-error'
  else if (driftSeconds > 0) verdict = 'drift'

  return { verdict, driftSeconds, failedParts, identityOk }
}

/**
 * Headroom over expected COGS before the job aborts, as a function of part count.
 *
 * The retry overhead's *mean* is a flat percentage regardless of n, but its tail
 * shrinks as n grows, so a single tuned constant is wrong in both directions:
 * 1.15 false-aborts ~1 in 100 jobs at 8 parts and over-provisions 48-part jobs.
 * `1 + ceil(0.05n + 0.75*sqrt(n)) / n` never under-shoots the exact-convolution
 * p99 for n in 2..192: 8 -> 37.5%, 24 -> 20.8%, 48 -> 16.7%, 96 -> 13.5%.
 * It only over-provisions at n <= 2, where the absolute cost is pennies.
 */
export function transcriptionAbortHeadroom(parts) {
  const n = Math.max(1, Math.floor(Number(parts) || 1))
  const extraChunks = Math.ceil(0.05 * n + 0.75 * Math.sqrt(n))
  return 1 + extraChunks / n
}

/**
 * Headroom used when the chunk plan isn't known yet. Assumes the shortest
 * realistic plan (8 parts, ~1.375); a real caller must pass `parts` so the
 * buffer tracks the plan instead of a guess.
 */
export const TRANSCRIPTION_ABORT_BUFFER = transcriptionAbortHeadroom(8)

/** Billing grid sizes the probe in `scripts/probe-transcription-billing.mjs` can return. */
export const BILLING_GRANULARITY_SECONDS = Object.freeze({
  exact: 0,
  '10s': 10,
  '60s': 60,
  '300s': 300,
})

/**
 * Seconds the provider will bill for a request we sent `sentSeconds` of audio.
 * `granularitySeconds: 0` means exact duration billing.
 */
export function billedSeconds(sentSeconds, granularitySeconds = 0) {
  const sent = Math.max(0, Number(sentSeconds) || 0)
  if (granularitySeconds <= 0) return sent
  return Math.ceil(sent / granularitySeconds) * granularitySeconds
}

/**
 * Cost of a single chunk.
 *
 * `reportedUsdc6` wins whenever the provider returned a positive `usage.cost`:
 * it is the only number that includes granularity rounding.
 *
 * A reported **zero** is treated as absent, not as free. Zero is indistinguishable
 * from "this response shape doesn't carry cost" — Vertex returns
 * `usageMetadata.*TokenCount` where Interactions returns `usage.total_output_tokens`,
 * and an adapter that misses the shape yields 0, not null. Trusting it would book
 * every chunk at $0 and the ledger would settle a job that cost us money.
 * Over-reporting is recoverable; under-reporting is not.
 */
export function chunkCostUsdc6({
  sentSeconds,
  reportedUsdc6 = null,
  granularitySeconds = 0,
  rateUsdc6PerSec = TRANSCRIPTION_RATE_USDC6_PER_SEC,
}) {
  const reported = Number(reportedUsdc6)
  if (reportedUsdc6 != null && Number.isFinite(reported) && reported > 0) {
    return { usdc6: Math.round(reported), source: 'reported', ignoredZeroReport: false }
  }
  const billed = billedSeconds(sentSeconds, granularitySeconds)
  return {
    usdc6: Math.round(billed * rateUsdc6PerSec),
    source: 'estimated',
    ignoredZeroReport: reportedUsdc6 != null && Number(reportedUsdc6) === 0,
  }
}

/**
 * Running accumulator for one transcription job.
 *
 * @param {object} options
 * @param {number} options.expectedUsdc6 - duration-seconds x pinned rate, no rounding
 * @param {number} [options.granularitySeconds] - from the lockfile
 * @param {number} [options.rateUsdc6PerSec]
 * @param {number} [options.parts] - chunk-plan part count; sets headroom via
 *   `transcriptionAbortHeadroom(parts)` when `buffer` is omitted
 * @param {number} [options.buffer] - explicit override, mainly for tests
 * @param {number} [options.quoteUsdc6] - price the user was quoted
 * @param {number} [options.marginFloor] - the ALERT threshold, e.g. 0.5: when COGS
 *   passes (1 - marginFloor) of the quote, margin has thinned and someone should
 *   look. This is not the abort line.
 * @param {number} [options.abortRatio=0.8] - hard stop. Abort when COGS exceeds
 *   this fraction of the quote.
 *
 * Two thresholds, two jobs. Finishing a job at a thin margin is always better
 * than releasing it: a release refunds the revenue AND leaves us holding the COGS
 * already spent. So the abort line sits near the point where finishing stops
 * paying for itself, and the margin floor becomes telemetry. Using the floor as
 * the abort line makes short jobs unretryable — at 60 minutes a single rebuild
 * ($0.06) breaches a 50% floor on a $0.45 quote, so the job would be abandoned
 * instead of finished for $0.09 of gross.
 */
export function createTranscriptionAccumulator({
  expectedUsdc6,
  granularitySeconds = 0,
  rateUsdc6PerSec = TRANSCRIPTION_RATE_USDC6_PER_SEC,
  parts = null,
  buffer = null,
  quoteUsdc6 = null,
  marginFloor = null,
  abortRatio = 0.8,
}) {
  const effectiveBuffer = buffer ?? transcriptionAbortHeadroom(parts ?? 8)
  const headroomLimitUsdc6 = Math.ceil(Math.max(0, Number(expectedUsdc6) || 0) * effectiveBuffer)
  const quote = quoteUsdc6 == null ? null : Math.max(0, Number(quoteUsdc6) || 0)
  const floorLimitUsdc6 = quote == null ? null : Math.ceil(quote * Math.min(1, Math.max(0, abortRatio)))
  const limitUsdc6 = floorLimitUsdc6 != null ? floorLimitUsdc6 : headroomLimitUsdc6
  const limitSource = floorLimitUsdc6 != null ? 'quote-abort-ratio' : 'headroom'
  /** COGS above this fraction of the quote has thinned margin; alert, don't abort. */
  const alertAtUsdc6 =
    quote != null && marginFloor != null ? Math.ceil(quote * (1 - Math.min(1, Math.max(0, marginFloor)))) : null
  const chunks = []
  let spentUsdc6 = 0
  let aborted = null
  let zeroReports = 0

  return {
    limitUsdc6,
    limitSource,
    alertAtUsdc6,
    /** Retries the abort limit buys at the pinned per-second rate. */
    retryAllowance: Math.max(
      0,
      Math.floor(
        (limitUsdc6 - Math.max(0, Number(expectedUsdc6) || 0)) /
          Math.max(1, rateUsdc6PerSec * CHIRP3_MAX_SUBFILE_SECONDS),
      ),
    ),
    get spentUsdc6() {
      return spentUsdc6
    },
    /** Chunks whose provider reported a zero cost, which we refused to believe. */
    get zeroReports() {
      return zeroReports
    },
    get chunks() {
      return chunks.slice()
    },
    get overBudget() {
      return aborted != null
    },
    /**
     * Record a chunk. Returns the running state plus whether the job must stop.
     * Once over budget the accumulator refuses further chunks, so a loop that
     * ignores the flag cannot keep spending.
     */
    add({ index, sentSeconds, reportedUsdc6 = null }) {
      if (aborted != null) {
        return { accepted: false, reason: 'already-aborted', spentUsdc6, limitUsdc6, index }
      }
      const { usdc6, source, ignoredZeroReport } = chunkCostUsdc6({
        sentSeconds,
        reportedUsdc6,
        granularitySeconds,
        rateUsdc6PerSec,
      })
      spentUsdc6 += usdc6
      if (ignoredZeroReport) zeroReports += 1
      chunks.push({ index, sentSeconds, usdc6, source })
      if (spentUsdc6 > limitUsdc6) {
        aborted = { index, spentUsdc6, limitUsdc6 }
        return { accepted: true, overBudget: true, spentUsdc6, limitUsdc6, chunkUsdc6: usdc6, source }
      }
      return { accepted: true, overBudget: false, spentUsdc6, limitUsdc6, chunkUsdc6: usdc6, source }
    },
  }
}

/**
 * What to hand `finalizeReservation()`. The ledger charges `actual` uncapped,
 * so the clamp has to live here or the receipt shows a price the user never saw.
 *
 * @returns {{ usdc6: number, clamped: boolean }}
 */
export function settleUsdc6(measuredUsdc6, bandPriceUsdc6) {
  const measured = Math.max(0, Math.round(Number(measuredUsdc6) || 0))
  const band = Math.max(0, Math.round(Number(bandPriceUsdc6) || 0))
  return { usdc6: Math.min(measured, band), clamped: measured > band }
}

/**
 * Grid-snapping invariant: a chunk plan may only snap to a grid that is a whole
 * multiple of the provider's billing grid, otherwise the snap re-introduces
 * rounding on every chunk instead of removing it.
 */
export function isSnapGridCompatible(gridSeconds, granularitySeconds = 0) {
  if (granularitySeconds <= 0) return true
  return gridSeconds > 0 && gridSeconds % granularitySeconds === 0
}

/* ------------------------------------------------------------------ *
 * Cache keys
 *
 * Two keys, deliberately split. The glossary post-pass runs locally over the
 * word list, so the provider never sees the glossary and the transcript bytes
 * are identical no matter what the user types. Putting the glossary in the
 * transcript key would re-run (and re-bill) a job whose COGS is zero and whose
 * result we already hold — charging the user for typing a name.
 *
 * A provider that accepts glossary terms as request context DOES change the
 * audio->text mapping, so that path passes `providerGlossaryHash` and gets a
 * distinct transcript key. Local biasing stays the guarantee either way.
 * ------------------------------------------------------------------ */

/** Trim, lower-case, drop empties, de-duplicate, sort — so term order never re-bills. */
export function normalizeGlossaryTerms(terms) {
  const seen = new Set()
  for (const term of Array.isArray(terms) ? terms : []) {
    const normalized = String(term ?? '').trim().toLowerCase()
    if (normalized) seen.add(normalized)
  }
  return [...seen].sort()
}

/** Stable hash of the normalized glossary; `null` when there is nothing to apply. */
export function glossaryHashOf(terms) {
  const normalized = normalizeGlossaryTerms(terms)
  if (normalized.length === 0) return null
  return createHash('sha256').update(normalized.join('\u0000')).digest('hex').slice(0, 16)
}

/**
 * Key for the stored transcript. Excludes the glossary unless the provider was
 * given it as context.
 */
export function transcriptCacheKey({
  fileSha,
  modelId,
  paramsVersion = '1',
  providerGlossaryHash = null,
}) {
  requireFragment('fileSha', fileSha)
  requireFragment('modelId', modelId)
  requireFragment('paramsVersion', paramsVersion && String(paramsVersion))
  const base = `asr:v1:${String(fileSha).slice(0, 32)}:${modelId}:${paramsVersion}`
  return providerGlossaryHash ? `${base}:pg${providerGlossaryHash}` : base
}

/** Key for the local glossary overlay applied on top of a cached transcript. */
export function glossaryOverlayCacheKey({ transcriptKey, glossaryHash, matcherVersion = '1' }) {
  requireFragment('transcriptKey', transcriptKey)
  requireFragment('glossaryHash', glossaryHash)
  requireFragment('matcherVersion', matcherVersion && String(matcherVersion))
  return `glo:v2:${transcriptKey}:${glossaryHash}:m${matcherVersion}`
}

function requireFragment(name, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
}
