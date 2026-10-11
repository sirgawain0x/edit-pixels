/**
 * Live Style — pricing and session limits (feature-flagged; default off).
 */

export const LIVE_STYLE_USDC6_PER_MINUTE_RETAIL = 100_000 // $0.10/min
export const LIVE_STYLE_USDC6_PER_MINUTE_PREMIUM = 80_000 // $0.08/min

/** Preset spend caps (USD) for per-session or daily authorization. */
export const LIVE_STYLE_CAP_PRESETS_USD = [1, 3, 6] as const
export type LiveStyleCapPresetUsd = (typeof LIVE_STYLE_CAP_PRESETS_USD)[number]

export const LIVE_STYLE_HEARTBEAT_INTERVAL_MS = 10_000
export const LIVE_STYLE_HEARTBEAT_MISS_MS = 30_000
export const LIVE_STYLE_PAYMENT_PULL_INTERVAL_MS = 60_000
export const LIVE_STYLE_CAP_WARN_REMAINING_SECONDS = 120
export const LIVE_STYLE_MIN_BILLABLE_SESSION_SECONDS = 60
export const LIVE_STYLE_MAX_SESSION_SECONDS = 60 * 60

export const LIVE_STYLE_PROVIDER_IDS = ['mock', 'local-echo', 'streamdiffusion'] as const
export type LiveStyleProviderId = (typeof LIVE_STYLE_PROVIDER_IDS)[number]

export function isLiveStyleEnabledClient(): boolean {
  const flag = import.meta.env.VITE_ENABLE_LIVE_STYLE
  return flag === '1' || flag === 'true'
}

export function usdc6PerMinuteForPremium(isPremium: boolean): number {
  return isPremium ? LIVE_STYLE_USDC6_PER_MINUTE_PREMIUM : LIVE_STYLE_USDC6_PER_MINUTE_RETAIL
}

export function capPresetToUsdc6(usd: LiveStyleCapPresetUsd): number {
  return usd * 1_000_000
}

export function secondsAffordableAtRate(capUsdc6: number, usdc6PerMinute: number): number {
  if (usdc6PerMinute <= 0) return 0
  // floor(cap / rate_per_second)
  const perSecond = usdc6PerMinute / 60
  return Math.floor(capUsdc6 / perSecond)
}
