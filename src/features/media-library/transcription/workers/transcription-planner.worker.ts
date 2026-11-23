/**
 * Worker that builds the sub-file plan for cloud transcription.
 *
 * Real implementation will:
 * 1. Decode the audio file into a Float32Array PCM stream.
 * 2. Run Silero VAD to find speech/silence boundaries.
 * 3. Cut at silence into chunks ≤ 1199.5s.
 * 4. For long continuous speech runs, force a mid-speech cut.
 * 5. Encode each sub-file to 24kbps mono Opus.
 * 6. Return the plan + encoded blobs.
 *
 * For now this is a stub that returns a deterministic plan matching the
 * mock behavior, so the picker UI can be developed against real shape.
 */

export interface PlannerSubFile {
  index: number
  /** Absolute start in seconds within the source audio. */
  startSec: number
  /** Absolute end in seconds within the source audio. */
  endSec: number
  /** Overlap with the next part, in seconds, counted inside this part's span. */
  overlapSec: number
  /** True when the cut was forced because no silence boundary existed before the 1199.5s clamp. */
  forcedCut: boolean
  /** Encoded Opus blob; null in the stub. */
  blob: Blob | null
}

export interface PlannerResult {
  sourceDurationSec: number
  subFiles: PlannerSubFile[]
  opusTotalBytes: number
}

export interface PlannerRequest {
  type: 'plan'
  file: File
  /** Source audio duration in seconds, from the media metadata. */
  sourceDurationSec: number
}

const MAX_SUB_SEC = 1199.5
const SILENCE_OVERLAP_SEC = 0.3
const FORCED_OVERLAP_SEC = 2.0

// Deterministic fixture durations for UI development, in seconds.
const SILENCE_CUT_DURATIONS_SEC = [
  18.67 * 60,
  19.2 * 60,
  17.85 * 60,
  19.45 * 60,
  18.1 * 60,
  19.9 * 60,
  16.3 * 60,
  19.55 * 60,
  18.75 * 60,
  17.4 * 60,
  19.25 * 60,
  18.0 * 60,
  17.1 * 60,
  18.5 * 60,
  17.9 * 60,
  18.4 * 60,
  17.5 * 60,
]

function generateStubPlan(sourceDurationSec: number): PlannerSubFile[] {
  const plan: PlannerSubFile[] = []
  let remaining = sourceDurationSec
  let cursor = 0
  let idx = 0

  while (remaining > 0.01 && idx < 1000) {
    const isForced = idx > 0 && idx % 3 === 0
    const overlapSec = isForced ? FORCED_OVERLAP_SEC : SILENCE_OVERLAP_SEC
    const baseDuration = isForced
      ? MAX_SUB_SEC
      : SILENCE_CUT_DURATIONS_SEC[idx % SILENCE_CUT_DURATIONS_SEC.length]!
    const nextDuration = Math.min(baseDuration, remaining)

    plan.push({
      index: idx,
      startSec: cursor,
      endSec: cursor + nextDuration,
      overlapSec,
      forcedCut: isForced,
      blob: null,
    })

    remaining -= nextDuration
    cursor += nextDuration - overlapSec
    idx += 1
  }

  if (plan.length === 0) return []
  const last = plan[plan.length - 1]!
  const sum = plan.reduce((s, p) => s + (p.endSec - p.startSec), 0)
  last.endSec += sourceDurationSec - sum

  return plan
}

self.onmessage = async (event: MessageEvent<PlannerRequest>) => {
  if (event.data.type !== 'plan') {
    self.postMessage({ type: 'error', message: 'Unknown planner request type' })
    return
  }

  const sourceDurationSec = event.data.sourceDurationSec || 0
  const subFiles = sourceDurationSec > 0 ? generateStubPlan(sourceDurationSec) : []

  self.postMessage({
    type: 'plan',
    result: {
      sourceDurationSec,
      subFiles,
      opusTotalBytes: 0,
    } satisfies PlannerResult,
  })
}

export {}
