import {
  DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM,
  DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL,
} from '@/config/billing'

/** Whole-minute estimate of Director timeline audio from a USDC6 top-up at a given per-minute rate. */
function estimateDirectorMinutesFromUsdc6(usdc6: number, usdc6PerAudioMinute: number): number {
  if (usdc6 <= 0 || usdc6PerAudioMinute <= 0) return 0
  return Math.round(usdc6 / usdc6PerAudioMinute)
}

export function estimateDirectorPackMinutes(usdc6: number): {
  retailMinutes: number
  premiumMinutes: number
} {
  return {
    retailMinutes: estimateDirectorMinutesFromUsdc6(usdc6, DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL),
    premiumMinutes: estimateDirectorMinutesFromUsdc6(
      usdc6,
      DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM,
    ),
  }
}
