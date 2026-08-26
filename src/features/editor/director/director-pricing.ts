/**
 * Creative Director pricing — per minute of timeline audio, settled in CRTVAI.
 *
 * Charges are prorated by exact audio seconds (seconds/60 × rate). Ledger /
 * quote amounts stay in usdc6 (USDC × 1e6). Display converts to CRTVAI via the
 * same usdc6→wei helper used by Live AI (`usdc6ToMetokenWei`).
 */

import {
  DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM,
  DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL,
} from '@/config/billing'
import { usdc6ToMetokenWei } from '@/config/metoken'

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
  /** CRTVAI amount to transfer (meToken wei, 18 decimals). */
  crtvaiWei: bigint
  /** Human CRTVAI amount for invoice UI (approx; 1 CRTVAI ≈ $1 at curve peg helpers). */
  crtvaiDisplay: number
  formattedUsd: string
  /** Human duration label, e.g. "4m 10s". */
  formattedDuration: string
  tier: 'premium' | 'retail'
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

export function quoteDirectorBrief(input: DirectorQuoteInput): DirectorQuote | null {
  const minutes = billableAudioMinutes(input.audioDurationSeconds)
  if (minutes <= 0) return null

  const isPremium = input.isPremium === true
  const usdc6PerMinute = isPremium
    ? DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM
    : DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL
  const estimatedUsdc6 = estimateDirectorUsdc6(input.audioDurationSeconds, usdc6PerMinute)
  if (estimatedUsdc6 <= 0) return null

  const crtvaiWei = usdc6ToMetokenWei(estimatedUsdc6)
  const crtvaiDisplay = Number(crtvaiWei) / 1e18

  return {
    audioDurationSeconds: input.audioDurationSeconds,
    billableMinutes: minutes,
    usdc6PerMinute,
    estimatedUsdc6,
    crtvaiWei,
    crtvaiDisplay,
    formattedUsd: `$${(estimatedUsdc6 / 1_000_000).toFixed(2)}`,
    formattedDuration: formatAudioDurationLabel(input.audioDurationSeconds),
    tier: isPremium ? 'premium' : 'retail',
  }
}

/** Recompute server-side minimum charge (always retail — no client membership trust). */
export function quoteDirectorBriefRetail(audioDurationSeconds: number): DirectorQuote | null {
  return quoteDirectorBrief({ audioDurationSeconds, isPremium: false })
}
