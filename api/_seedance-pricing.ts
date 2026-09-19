/**
 * Server-side Seedance pricing — mirrors src/config/seedance.ts.
 */
// fallow-ignore-file unused-export

export const SEEDANCE_MODEL_ID = 'bytedance/seedance-2.5/text-to-video'
export const SEEDANCE_DEFAULT_DURATION_SEC = 5
export const SEEDANCE_MIN_DURATION_SEC = 4
export const SEEDANCE_MAX_DURATION_SEC = 30

export type SeedanceResolution = '480p' | '720p'
export type SeedanceAspectRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9'

const SEEDANCE_USD_PER_SEC: Record<SeedanceResolution, number> = {
  '480p': 0.144,
  '720p': 0.3236,
}

export function isSeedanceGenerateEnabled(): boolean {
  const flag = process.env.SEEDANCE_GENERATE_ENABLED ?? process.env.VITE_ENABLE_SEEDANCE_GENERATE
  return flag === '1' || flag === 'true'
}

export function clampSeedanceDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return SEEDANCE_DEFAULT_DURATION_SEC
  const rounded = Math.round(seconds)
  return Math.min(SEEDANCE_MAX_DURATION_SEC, Math.max(SEEDANCE_MIN_DURATION_SEC, rounded))
}

export function quoteSeedanceUsdc6(input: {
  duration: number
  resolution: SeedanceResolution
}): number {
  const duration = clampSeedanceDuration(input.duration)
  const resolution = input.resolution === '480p' ? '480p' : '720p'
  const usd = duration * SEEDANCE_USD_PER_SEC[resolution]
  return Math.max(1, Math.ceil(usd * 1_000_000))
}

export function quoteSeedanceMinCrtvaiWei(estimatedUsdc6: number): bigint {
  return BigInt(estimatedUsdc6) * 10n ** 12n
}
