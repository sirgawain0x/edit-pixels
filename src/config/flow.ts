/**
 * Flow segment duration limits (Veo 3.1 on Vertex AI).
 * Longer films use multi-segment chaining (last frame → next first).
 */
// fallow-ignore-file unused-type

export const FLOW_ALLOWED_DURATIONS = [4, 6, 8] as const
export type FlowDurationSec = (typeof FLOW_ALLOWED_DURATIONS)[number]

export const FLOW_DURATION_DEFAULT_SEC: FlowDurationSec = 8

export type FlowQuality = '720p' | '1080p' | '4K'
export type FlowTier = 'standard' | 'fast' | 'lite'

export function clampFlowDuration(seconds: number): FlowDurationSec {
  if (!Number.isFinite(seconds)) return FLOW_DURATION_DEFAULT_SEC
  const rounded = Math.round(seconds)
  if (FLOW_ALLOWED_DURATIONS.includes(rounded as FlowDurationSec)) {
    return rounded as FlowDurationSec
  }
  return FLOW_ALLOWED_DURATIONS.reduce((best, d) =>
    Math.abs(d - rounded) < Math.abs(best - rounded) ? d : best,
  )
}

export function normalizeFlowQuality(quality: string, tier: FlowTier): FlowQuality {
  const q = quality === '4k' || quality === '4K' ? '4K' : quality === '1080p' ? '1080p' : '720p'
  if (tier === 'lite' && q === '4K') return '1080p'
  return q
}
