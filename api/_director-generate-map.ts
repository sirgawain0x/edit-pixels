/**
 * Map Creative Director storyboard shots → Pixels Generate requests.
 * Shared by batch-quote and batch-confirm (Phase 2 Director bridge).
 */
// fallow-ignore-file unused-export

import {
  clampSeedanceDuration,
  type SeedanceAspectRatio,
  type SeedanceResolution,
} from './_seedance-pricing.js'
import { clampFlowDuration } from './_generative-pricing.js'

export type PixelsRenderProvider = 'veo' | 'seedance'

export type DirectorProviderPreference = PixelsRenderProvider

/** Shot shape from Creative Director storyboard (stable contract). */
export interface DirectorStoryboardShotInput {
  shotId: string
  prompt: string
  duration?: number
  /** e.g. "16:9", "9:16", "1:1" */
  aspectRatio?: string
  /** Prefer Seedance when true (character consistency). */
  consistentCharacter?: boolean
  resolution?: SeedanceResolution
}

export interface DirectorGenerateRequest {
  shotId: string
  prompt: string
  duration: number
  aspect_ratio: SeedanceAspectRatio
  resolution: SeedanceResolution
  /** Veo uses clamped flow duration; Seedance uses seedance duration. */
  veoDuration: number
  seedanceDuration: number
}

const VALID_ASPECTS: readonly SeedanceAspectRatio[] = [
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
  '21:9',
]

export function normalizeDirectorAspectRatio(raw: string | undefined): SeedanceAspectRatio {
  const trimmed = raw?.trim()
  if (trimmed && (VALID_ASPECTS as readonly string[]).includes(trimmed)) {
    return trimmed as SeedanceAspectRatio
  }
  return '16:9'
}

export function normalizeDirectorResolution(raw: string | undefined): SeedanceResolution {
  return raw === '480p' ? '480p' : '720p'
}

export function mapDirectorShotToGenerate(
  shot: DirectorStoryboardShotInput,
): DirectorGenerateRequest | null {
  const shotId = shot.shotId?.trim()
  const prompt = shot.prompt?.trim()
  if (!shotId || !prompt) return null

  const rawDuration =
    typeof shot.duration === 'number' && Number.isFinite(shot.duration) ? shot.duration : 5
  const resolution = normalizeDirectorResolution(shot.resolution)
  const aspect_ratio = normalizeDirectorAspectRatio(shot.aspectRatio)

  return {
    shotId,
    prompt,
    duration: rawDuration,
    aspect_ratio,
    resolution,
    veoDuration: clampFlowDuration(rawDuration),
    seedanceDuration: clampSeedanceDuration(rawDuration),
  }
}

/**
 * Pick render provider for a shot.
 * Seedance when consistent-character is flagged; else user preference; else Veo.
 */
export function pickDirectorShotProvider(
  shot: Pick<DirectorStoryboardShotInput, 'consistentCharacter'>,
  preference?: DirectorProviderPreference | null,
): PixelsRenderProvider {
  if (shot.consistentCharacter) return 'seedance'
  if (preference === 'veo' || preference === 'seedance') return preference
  return 'veo'
}

export function sumCrtvaiWei(values: bigint[]): bigint {
  let total = 0n
  for (const value of values) {
    total += value
  }
  return total
}
