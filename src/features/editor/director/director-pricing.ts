/**
 * Creative Director pricing — per minute of timeline audio (USD list price).
 * meToken settlement amounts come from server curve quotes only.
 */

import {
  DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM,
  DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL,
} from '@/config/billing'

export interface DirectorQuoteInput {
  /** Primary timeline audio duration in seconds. */
  audioDurationSeconds: number
  isPremium?: boolean
}

export interface DirectorQuote {
  audioDurationSeconds: number
  /** Exact audio length in minutes (seconds / 60). */
  billableMinutes: number
  usdc6PerMinute: number
  estimatedUsdc6: number
  /** meToken wei from server quote (never computed client-side). */
  crtvaiWei: bigint
  crtvaiDisplay: number
  formattedUsd: string
  /** Human duration label, e.g. "4m 10s". */
  formattedDuration: string
  tier: 'premium' | 'retail'
  quoteId?: string
  signature?: string
  expiresAtMs?: number
  slippageBps?: number
}

/** Exact billable minutes from audio length. Returns 0 when duration is non-positive. */
export function billableAudioMinutes(audioDurationSeconds: number): number {
  if (!Number.isFinite(audioDurationSeconds) || audioDurationSeconds <= 0) return 0
  return audioDurationSeconds / 60
}

/** Format seconds as Xm Ys (omits zero parts when clean). */
export function formatAudioDurationLabel(audioDurationSeconds: number): string {
  const total = Math.max(0, Math.round(audioDurationSeconds))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes <= 0) return `${seconds}s`
  if (seconds === 0) return `${minutes}m`
  return `${minutes}m ${seconds}s`
}

/** Prorated usdc6 charge: round(seconds × ratePerMinute / 60). */
export function estimateDirectorUsdc6(
  audioDurationSeconds: number,
  usdc6PerMinute: number,
): number {
  if (!Number.isFinite(audioDurationSeconds) || audioDurationSeconds <= 0) return 0
  if (!Number.isFinite(usdc6PerMinute) || usdc6PerMinute <= 0) return 0
  return Math.round((audioDurationSeconds * usdc6PerMinute) / 60)
}

/** USD list price only — use `fetchDirectorServerQuote` before checkout. */
export function quoteDirectorBriefUsd(input: DirectorQuoteInput): Omit<
  DirectorQuote,
  'crtvaiWei' | 'crtvaiDisplay'
> | null {
  const minutes = billableAudioMinutes(input.audioDurationSeconds)
  if (minutes <= 0) return null

  const isPremium = input.isPremium === true
  const usdc6PerMinute = isPremium
    ? DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM
    : DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL
  const estimatedUsdc6 = estimateDirectorUsdc6(input.audioDurationSeconds, usdc6PerMinute)
  if (estimatedUsdc6 <= 0) return null

  return {
    audioDurationSeconds: input.audioDurationSeconds,
    billableMinutes: minutes,
    usdc6PerMinute,
    estimatedUsdc6,
    formattedUsd: `$${(estimatedUsdc6 / 1_000_000).toFixed(2)}`,
    formattedDuration: formatAudioDurationLabel(input.audioDurationSeconds),
    tier: isPremium ? 'premium' : 'retail',
  }
}

/** @deprecated Use `fetchDirectorServerQuote` for checkout amounts. */
export function quoteDirectorBrief(input: DirectorQuoteInput): DirectorQuote | null {
  const usd = quoteDirectorBriefUsd(input)
  if (!usd) return null
  return {
    ...usd,
    crtvaiWei: 0n,
    crtvaiDisplay: 0,
  }
}

/** @deprecated Use `fetchDirectorServerQuote` for checkout amounts. */
export function quoteDirectorBriefRetail(audioDurationSeconds: number): DirectorQuote | null {
  return quoteDirectorBrief({ audioDurationSeconds, isPremium: false })
}
