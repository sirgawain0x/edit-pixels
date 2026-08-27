/**
 * Flow segment duration limits (Seedance 2.0 image-to-video).
 * Longer films use multi-segment chaining (last frame → next first).
 */
// fallow-ignore-file unused-type

export const FLOW_DURATION_MIN_SEC = 4
export const FLOW_DURATION_MAX_SEC = 15
export const FLOW_DURATION_DEFAULT_SEC = 5

export type FlowQuality = '480p' | '720p' | '1080p'
export type FlowSpeed = 'standard' | 'fast'

export function clampFlowDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return FLOW_DURATION_DEFAULT_SEC
  return Math.min(FLOW_DURATION_MAX_SEC, Math.max(FLOW_DURATION_MIN_SEC, Math.round(seconds)))
}
