/**
 * Pure timing math for Phase 4 — lay Director batch clips on the timeline
 * aligned to the master audio track.
 */

export interface DirectorShotTimingInput {
  shotId: string
  /** Hint duration in seconds (from storyboard or generate quote). */
  durationSeconds?: number
  /** Absolute offset from audio start (seconds). */
  startSeconds?: number
  /** Absolute end offset from audio start (seconds). */
  endSeconds?: number
}

export interface DirectorShotPlacement {
  shotId: string
  startFrame: number
  durationInFrames: number
}

export interface ComputeDirectorBatchPlacementsInput {
  shots: readonly DirectorShotTimingInput[]
  audioDurationSeconds: number
  audioStartFrame: number
  fps: number
}

function shotDurationSeconds(shot: DirectorShotTimingInput): number | undefined {
  if (shot.startSeconds !== undefined && shot.endSeconds !== undefined) {
    const span = shot.endSeconds - shot.startSeconds
    return span > 0 ? span : undefined
  }
  if (shot.durationSeconds !== undefined && shot.durationSeconds > 0) {
    return shot.durationSeconds
  }
  return undefined
}

function hasStoryboardTimings(shots: readonly DirectorShotTimingInput[]): boolean {
  return (
    shots.length > 0 &&
    shots.every(
      (shot) =>
        shot.startSeconds !== undefined &&
        (shot.endSeconds !== undefined || shot.durationSeconds !== undefined),
    )
  )
}

function secondsToDurationFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps))
}

function secondsToOffsetFrames(seconds: number, fps: number): number {
  return Math.max(0, Math.round(seconds * fps))
}

function clampPlacementsToAudio(
  placements: DirectorShotPlacement[],
  audioStartFrame: number,
  audioDurationSeconds: number,
  fps: number,
): DirectorShotPlacement[] {
  const audioEndFrame = audioStartFrame + secondsToDurationFrames(audioDurationSeconds, fps)
  return placements.map((placement) => {
    const startFrame = Math.max(audioStartFrame, placement.startFrame)
    const maxDuration = Math.max(1, audioEndFrame - startFrame)
    const durationInFrames = Math.min(placement.durationInFrames, maxDuration)
    return { ...placement, startFrame, durationInFrames }
  })
}

function computeStoryboardPlacements(
  shots: readonly DirectorShotTimingInput[],
  audioStartFrame: number,
  fps: number,
): DirectorShotPlacement[] {
  return shots.map((shot) => {
    const startSeconds = shot.startSeconds ?? 0
    const duration =
      shot.endSeconds !== undefined
        ? shot.endSeconds - startSeconds
        : (shot.durationSeconds ?? 1)
    return {
      shotId: shot.shotId,
      startFrame: audioStartFrame + secondsToOffsetFrames(startSeconds, fps),
      durationInFrames: secondsToDurationFrames(Math.max(duration, 1 / fps), fps),
    }
  })
}

function computeSequentialPlacements(
  shots: readonly DirectorShotTimingInput[],
  audioStartFrame: number,
  audioDurationSeconds: number,
  fps: number,
): DirectorShotPlacement[] {
  const hintedDurations = shots.map((shot) => shotDurationSeconds(shot))
  const allHaveHints = hintedDurations.every((duration) => duration !== undefined)

  let cursorSeconds = 0
  let durations: number[]

  if (allHaveHints) {
    const raw = hintedDurations as number[]
    const total = raw.reduce((sum, value) => sum + value, 0)
    if (total > audioDurationSeconds && total > 0) {
      const scale = audioDurationSeconds / total
      durations = raw.map((value) => value * scale)
    } else {
      durations = raw
    }
  } else {
    const slot = shots.length > 0 ? audioDurationSeconds / shots.length : audioDurationSeconds
    durations = shots.map(() => slot)
  }

  const placements: DirectorShotPlacement[] = []
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index]!
    const durationSeconds = durations[index] ?? audioDurationSeconds / shots.length
    const remaining = Math.max(0, audioDurationSeconds - cursorSeconds)
    const clampedDuration = Math.min(durationSeconds, remaining > 0 ? remaining : durationSeconds)
    placements.push({
      shotId: shot.shotId,
      startFrame: audioStartFrame + secondsToOffsetFrames(cursorSeconds, fps),
      durationInFrames: secondsToDurationFrames(Math.max(clampedDuration, 1 / fps), fps),
    })
    cursorSeconds += clampedDuration
  }

  return placements
}

/**
 * Compute per-shot timeline offsets from storyboard timings or an equal split.
 * Storyboard mode requires every shot to have `startSeconds` plus `endSeconds` or `durationSeconds`.
 * Otherwise shots are placed sequentially from audio start (equal split or sum-of-hints clamped to audio).
 */
export function computeDirectorBatchPlacements(
  input: ComputeDirectorBatchPlacementsInput,
): DirectorShotPlacement[] {
  const { shots, audioDurationSeconds, audioStartFrame, fps } = input
  const safeFps = fps > 0 ? fps : 30
  const safeAudioDuration = Math.max(1 / safeFps, audioDurationSeconds)

  if (shots.length === 0) return []

  const base = hasStoryboardTimings(shots)
    ? computeStoryboardPlacements(shots, audioStartFrame, safeFps)
    : computeSequentialPlacements(shots, audioStartFrame, safeAudioDuration, safeFps)

  return clampPlacementsToAudio(base, audioStartFrame, safeAudioDuration, safeFps)
}
