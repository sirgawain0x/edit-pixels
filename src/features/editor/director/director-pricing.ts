/**
 * Creative Director pricing — per minute of timeline audio, settled in CRTVAI.
 *
 * Ledger / quote amounts stay in usdc6 (USDC × 1e6). Display converts to CRTVAI
 * via the same usdc6→wei helper used by Live AI (`usdc6ToMetokenWei`).
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
  /** ceil(seconds/60), minimum 1 when audio is present. */
  billableMinutes: number
  usdc6PerMinute: number
  estimatedUsdc6: number
  /** CRTVAI amount to transfer (meToken wei, 18 decimals). */
  crtvaiWei: bigint
  /** Human CRTVAI amount for invoice UI (approx; 1 CRTVAI ≈ $1 at curve peg helpers). */
  crtvaiDisplay: number
  formattedUsd: string
  tier: 'premium' | 'retail'
}

/** Whole billable minutes from audio length. Returns 0 when duration is non-positive. */
export function billableAudioMinutes(audioDurationSeconds: number): number {
  if (!Number.isFinite(audioDurationSeconds) || audioDurationSeconds <= 0) return 0
  return Math.max(1, Math.ceil(audioDurationSeconds / 60))
}

export function quoteDirectorBrief(input: DirectorQuoteInput): DirectorQuote | null {
  const minutes = billableAudioMinutes(input.audioDurationSeconds)
  if (minutes <= 0) return null

  const isPremium = input.isPremium === true
  const usdc6PerMinute = isPremium
    ? DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM
    : DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL
  const estimatedUsdc6 = minutes * usdc6PerMinute
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
    tier: isPremium ? 'premium' : 'retail',
  }
}

/** Recompute server-side minimum charge (always retail — no client membership trust). */
export function quoteDirectorBriefRetail(audioDurationSeconds: number): DirectorQuote | null {
  return quoteDirectorBrief({ audioDurationSeconds, isPremium: false })
}
