/**
 * Pricing engine for Pixels MCP billing.
 *
 * All prices are stored as USDC-equivalent with 6 decimals (usdc6) for
 * precision. CRTVAI meToken deposits are converted to usdc6 via the on-chain
 * bonding curve, but the ledger always settles in usdc6 so credits do not
 * fluctuate with the meToken price.
 *
 * Cost model:
 *  - render: base rate per second of output duration, scaled by quality and
 *    GPU effect density.
 *  - edit: flat per-operation cost plus a small per-second preview fee.
 *  - project create/list/get: free.
 *  - media import/list: free.
 */

/** $0.125 USDC per 5-minute interval (premium / cost basis). */
export const INTERVAL_COST_PREMIUM_USDC6 = 125_000

/** $0.25 USDC per 5-minute interval (retail). */
export const INTERVAL_COST_RETAIL_USDC6 = 250_000

/** Seconds per billing interval. */
const BILLING_INTERVAL_SECONDS = 300

/** Quality multipliers applied to the per-second base rate. */
const QUALITY_MULTIPLIERS = {
  low: 0.75,
  medium: 1.0,
  high: 1.5,
  ultra: 2.5,
}

/** GPU effect density multipliers (approximate fraction of timeline clips using GPU effects). */
const GPU_DENSITY_MULTIPLIERS = {
  none: 1.0,
  light: 1.25,
  medium: 1.75,
  heavy: 2.5,
}

/** Edit operation flat cost in usdc6 (retail; premium is half). */
const EDIT_OPERATION_FLAT_USDC6 = 1_000

/** Per-second of source/preview time charged for edit calls (usdc6 per second). */
const EDIT_PREVIEW_RATE_USDC6_PER_SEC = 2

/**
 * Per-second base rate in usdc6.
 * Derived from interval cost so premium/retail rates stay consistent with
 * Live AI streaming pricing.
 */
function renderBaseRateUsdc6PerSecond(intervalCostUsdc6) {
  return intervalCostUsdc6 / BILLING_INTERVAL_SECONDS
}

/**
 * Estimate the cost of a render job before it runs.
 *
 * @param {object} options
 * @param {number} options.durationSeconds - output duration in seconds
 * @param {number} [options.intervalCostUsdc6] - premium/retail interval rate
 * @param {string} [options.quality='medium'] - low | medium | high | ultra
 * @param {string} [options.gpuDensity='none'] - none | light | medium | heavy
 * @param {boolean} [options.audioOnly=false]
 */
// fallow-ignore-next-line complexity
export function estimateRenderCostUsdc6({
  durationSeconds,
  intervalCostUsdc6 = INTERVAL_COST_RETAIL_USDC6,
  quality = 'medium',
  gpuDensity = 'none',
  audioOnly = false,
}) {
  const duration = Math.max(0, Number(durationSeconds) || 0)
  const baseRate = renderBaseRateUsdc6PerSecond(intervalCostUsdc6)
  const qualityMultiplier = QUALITY_MULTIPLIERS[quality] ?? QUALITY_MULTIPLIERS.medium
  const gpuMultiplier = GPU_DENSITY_MULTIPLIERS[gpuDensity] ?? GPU_DENSITY_MULTIPLIERS.none
  const audioMultiplier = audioOnly ? 0.4 : 1.0
  const cost = duration * baseRate * qualityMultiplier * gpuMultiplier * audioMultiplier
  return Math.max(0, Math.round(cost))
}

/**
 * Estimate the cost of an edit operation before it runs.
 *
 * @param {object} options
 * @param {number} options.opCount - number of edit ops
 * @param {number} [options.previewSeconds=0] - approximate preview timeline seconds
 * @param {number} [options.intervalCostUsdc6] - premium/retail interval rate
 */
export function estimateEditCostUsdc6({
  opCount,
  previewSeconds = 0,
  intervalCostUsdc6 = INTERVAL_COST_RETAIL_USDC6,
}) {
  // Premium halves the flat per-op cost; this mirrors the interval discount.
  const isPremium = intervalCostUsdc6 <= INTERVAL_COST_PREMIUM_USDC6
  const flatPerOp = isPremium ? Math.ceil(EDIT_OPERATION_FLAT_USDC6 / 2) : EDIT_OPERATION_FLAT_USDC6
  const preview = Math.max(0, Number(previewSeconds) || 0) * EDIT_PREVIEW_RATE_USDC6_PER_SEC
  const ops = Math.max(0, Number(opCount) || 0) * flatPerOp
  return Math.max(0, Math.round(ops + preview))
}

/** $0.05 USDC per minute of timeline audio (retail Director rate). */
export const DIRECTOR_USDC6_PER_AUDIO_MINUTE = INTERVAL_COST_RETAIL_USDC6 / 5

/**
 * Transcript pricing: $0.0099 USDC per minute of submitted audio, capped per run.
 *
 * gemini-3.5-transcribe bills tokens, not seconds: measured COGS is
 * $0.0056/min at chunk scale and $0.0062/min on short clips (the per-request
 * prompt overhead amortises), against $0.003/min for the Chirp 3 batch it
 * replaces. $0.0075 left an 18-38% margin — inside the range where one retry of
 * a long part eats the run — so the rate moved to $0.0099, which holds 38-43%.
 *
 * Price off the post-credit COGS, never off a $0 COGS: startup credits are gross
 * margin, not a price input, and a ladder built on credits goes negative the day
 * the pool empties.
 */
export const TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE = 9_900

/**
 * $4.752 USDC ceiling for a single transcription run.
 *
 * Deliberately EQUAL to the price at the 480-minute ceiling
 * (480 × 9,900 usdc6), so the cap never binds on a correctly-planned job and
 * only fires when the planner miscounts. A cap below the ceiling price sells the
 * longest jobs at zero retry headroom, which is a loss the first time a part is
 * rebuilt.
 *
 * Raised from $3.60 with the rate: keeping the old number would silently cut the
 * maximum run from 480 minutes to 363.
 */
export const TRANSCRIPTION_RUN_CAP_USDC6 = 4_752_000

/** Hard ceiling on submitted audio for one run; longer jobs must be split. */
export const TRANSCRIPTION_MAX_AUDIO_MINUTES = 480

/**
 * Quote a transcription run.
 *
 * Duration is measured *after* the planner produces a chunk plan, not from what
 * the user dropped: a firm price for audio we have not decoded is a price we
 * cannot honour.
 *
 * @param {object} options
 * @param {number} options.audioDurationSeconds
 * @param {number} [options.perMinuteUsdc6]
 * @param {number} [options.capUsdc6]
 */
export function estimateTranscriptionCostUsdc6({
  audioDurationSeconds,
  perMinuteUsdc6 = TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE,
  capUsdc6 = TRANSCRIPTION_RUN_CAP_USDC6,
}) {
  const seconds = Number(audioDurationSeconds) || 0
  if (seconds <= 0) return 0
  const raw = Math.round((seconds / 60) * perMinuteUsdc6)
  return Math.max(0, Math.min(raw, capUsdc6))
}

/**
 * Reject over-length runs in one place. A 480-minute ceiling is a product rule,
 * not a pricing rule: past it the run is a support conversation either way.
 *
 * @param {number} audioDurationSeconds
 */
export function assertTranscriptionDurationAllowed(
  audioDurationSeconds,
  maxMinutes = TRANSCRIPTION_MAX_AUDIO_MINUTES,
) {
  const seconds = Number(audioDurationSeconds) || 0
  if (seconds > maxMinutes * 60) {
    throw new RangeError(
      `Audio is ${(seconds / 60).toFixed(1)} minutes; split it under ${maxMinutes} minutes per run.`,
    )
  }
  return true
}

/**
 * Estimate Creative Director cost from timeline audio duration.
 * Prorates by exact seconds: round(seconds × (intervalCost/5) / 60).
 *
 * @param {object} options
 * @param {number} options.audioDurationSeconds
 * @param {number} [options.intervalCostUsdc6]
 */
export function estimateDirectorCostUsdc6({
  audioDurationSeconds,
  intervalCostUsdc6 = INTERVAL_COST_RETAIL_USDC6,
}) {
  const seconds = Number(audioDurationSeconds) || 0
  if (seconds <= 0) return 0
  const perMinute = intervalCostUsdc6 / 5
  return Math.round((seconds * perMinute) / 60)
}

/**
 * Convert CRTVAI meToken wei (18 decimals) to usdc6 using the current meToken price.
 *
 * The meToken price returned by `getCurrentPrice()` is in raw units. For
 * hub 2 the convention observed in the UI is 1 meToken wei = price * 1e12 usdc6.
 *
 * @param {bigint} metokenWei - CRTVAI amount in wei (18 decimals)
 * @param {bigint} currentPrice - raw meToken price from getCurrentPrice()
 */
export function metokenWeiToUsdc6(metokenWei, currentPrice) {
  // currentPrice is a uint256 with 12 implied decimals relative to usdc6.
  // 1 meToken (1e18 wei) * currentPrice / 1e18 = usdc6 * 1e12
  // => meTokenWei * currentPrice / 1e18 = usdc6 * 1e12
  // => (meTokenWei * currentPrice) / 1e30 = usdc6
  return Number((metokenWei * currentPrice) / 10n ** 30n)
}

/**
 * Format usdc6 as a human USD string.
 */
export function formatUsdc6(usdc6) {
  return `$${(Number(usdc6) / 1_000_000).toFixed(4)}`
}
