/**
 * Flow segment duration limits (Veo 3.1 + Gemini Omni 1.2 Flash on Vertex AI).
 * Longer films use multi-segment chaining (last frame → next first).
 */
// fallow-ignore-file unused-type

const FLOW_ALLOWED_DURATIONS = [4, 6, 8] as const
export type FlowDurationSec = (typeof FLOW_ALLOWED_DURATIONS)[number]

const FLOW_OMNI_ALLOWED_DURATIONS = [4, 6, 8, 10] as const
export type FlowOmniDurationSec = (typeof FLOW_OMNI_ALLOWED_DURATIONS)[number]

export const FLOW_DURATION_DEFAULT_SEC: FlowDurationSec = 8

export type FlowQuality = '360p' | '720p' | '1080p' | '4K'
export type FlowTier = 'standard' | 'fast' | 'lite' | 'omni'

export function getFlowAllowedDurations(tier: FlowTier): readonly number[] {
  return tier === 'omni' ? FLOW_OMNI_ALLOWED_DURATIONS : FLOW_ALLOWED_DURATIONS
}

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

export function clampFlowDurationForTier(seconds: number, tier: FlowTier): number {
  if (tier !== 'omni') return clampFlowDuration(seconds)
  if (!Number.isFinite(seconds)) return FLOW_DURATION_DEFAULT_SEC
  const rounded = Math.round(seconds)
  if (FLOW_OMNI_ALLOWED_DURATIONS.includes(rounded as FlowOmniDurationSec)) {
    return rounded
  }
  return FLOW_OMNI_ALLOWED_DURATIONS.reduce((best, d) =>
    Math.abs(d - rounded) < Math.abs(best - rounded) ? d : best,
  )
}

export function normalizeFlowQuality(quality: string, tier: FlowTier): FlowQuality {
  if (quality === '360p') {
    return tier === 'omni' ? '360p' : '720p'
  }
  const q = quality === '4k' || quality === '4K' ? '4K' : quality === '1080p' ? '1080p' : '720p'
  if (tier === 'lite' && q === '4K') return '1080p'
  return q
}
