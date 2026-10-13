/**
 * Creative Pixels — Higgsfield Seedance 2.5 text-to-video (feature-flagged).
 */
// fallow-ignore-file unused-export

export const SEEDANCE_MODEL_ID = 'bytedance/seedance-2.5/text-to-video'

export const SEEDANCE_DEFAULT_DURATION_SEC = 5
export const SEEDANCE_MIN_DURATION_SEC = 4
export const SEEDANCE_MAX_DURATION_SEC = 30

export type SeedanceResolution = '480p' | '720p'
export type SeedanceAspectRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9'

/** Undiscounted Higgsfield list rates (USD per output second). */
const SEEDANCE_USD_PER_SEC: Record<SeedanceResolution, number> = {
  '480p': 0.144,
  '720p': 0.3236,
}

export function isSeedanceGenerateEnabled(): boolean {
  const flag = import.meta.env.VITE_ENABLE_SEEDANCE_GENERATE
  return flag === '1' || flag === 'true'
}

export function clampSeedanceDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return SEEDANCE_DEFAULT_DURATION_SEC
  const rounded = Math.round(seconds)
  return Math.min(SEEDANCE_MAX_DURATION_SEC, Math.max(SEEDANCE_MIN_DURATION_SEC, rounded))
}

export interface SeedanceQuoteInput {
  duration: number
  resolution: SeedanceResolution
}

export interface SeedanceQuote {
  duration: number
  resolution: SeedanceResolution
  estimatedUsdc6: number
  crtvaiWei: bigint
  crtvaiDisplay: number
  formattedUsd: string
}

/** USD list price only — request `/api/seedance-quote` for live meToken amounts. */
export function quoteSeedanceGeneration(input: SeedanceQuoteInput): SeedanceQuote {
  const duration = clampSeedanceDuration(input.duration)
  const resolution = input.resolution === '480p' ? '480p' : '720p'
  const usd = duration * SEEDANCE_USD_PER_SEC[resolution]
  const estimatedUsdc6 = Math.max(1, Math.ceil(usd * 1_000_000))

  return {
    duration,
    resolution,
    estimatedUsdc6,
    crtvaiWei: 0n,
    crtvaiDisplay: 0,
    formattedUsd: `$${(estimatedUsdc6 / 1_000_000).toFixed(2)}`,
  }
}
