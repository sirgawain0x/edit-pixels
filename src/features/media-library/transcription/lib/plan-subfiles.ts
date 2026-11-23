/**
 * Cut a long recording into sub-files for the cloud transcription model.
 *
 * Two rules drive everything here:
 *
 *  - Never cut through speech. Cuts land in the middle of a silence window when one is
 *    available, because the model cannot transcribe audio it was never given.
 *  - Never exceed the provider's cap. When a stretch of continuous speech is longer than
 *    one part, the cut is forced mid-speech and the overlap doubles, so a word straddling
 *    the boundary appears twice rather than disappearing. Downstream
 *    `dedupe-transcript-words` removes the duplicate.
 *
 * `overlapSec` is counted *inside* a part's span, so the next part starts at
 * `endSec - overlapSec`. That keeps coverage contiguous while letting consecutive parts
 * share audio, and it is why the parts' lengths sum to more than the source duration.
 */
import type { SilenceWindow } from './silence-detect'

/** 20 minutes, minus half a second: the model truncates silently past its cap. */
export const DEFAULT_MAX_PART_SECONDS = 20 * 60 - 0.5

/** Enough to cover a word's onset and offset without re-transcribing whole sentences. */
const DEFAULT_SILENCE_OVERLAP_SECONDS = 0.3

/** Mid-speech cuts need more: a word can be 2 s long. */
const DEFAULT_FORCED_OVERLAP_SECONDS = 2

/** Do not emit a stub part just because a silence happened to sit near the start. */
const DEFAULT_MIN_PART_SECONDS = 30

export interface SubFilePlan {
  index: number
  /** Absolute start within the source audio. */
  startSec: number
  /** Absolute end within the source audio. */
  endSec: number
  /** Seconds inside this part's span that the next part repeats. Zero for the last part. */
  overlapSec: number
  /** True when no silence window was usable and the cut was placed mid-speech. */
  forcedCut: boolean
}

export interface PlanSubFilesInput {
  durationSec: number
  silenceWindows: readonly SilenceWindow[]
  maxPartSeconds?: number
  silenceOverlapSeconds?: number
  forcedOverlapSeconds?: number
  minPartSeconds?: number
}

interface CutPoint {
  endSec: number
  overlapSec: number
  forcedCut: boolean
}

/**
 * Latest silence that fits entirely before `limitSec` and leaves at least `minPartSeconds`
 * of audio behind it. Latest, not longest: it packs each part as full as the cap allows,
 * which keeps the part count (and so the request count) down.
 */
function silenceCutWithin(
  windows: readonly SilenceWindow[],
  fromSec: number,
  limitSec: number,
  minPartSeconds: number,
): SilenceWindow | null {
  let best: SilenceWindow | null = null
  for (const window of windows) {
    const midpoint = (window.startSec + window.endSec) / 2
    if (midpoint < fromSec + minPartSeconds) continue
    if (window.endSec > limitSec) continue
    if (best === null || midpoint > (best.startSec + best.endSec) / 2) best = window
  }
  return best
}

function cutAtSilence(window: SilenceWindow, limitSec: number, overlapSec: number): CutPoint {
  const midpoint = (window.startSec + window.endSec) / 2
  // Half the overlap on each side of the midpoint, so both parts get the same cushion.
  return {
    endSec: Math.min(midpoint + overlapSec / 2, limitSec),
    overlapSec,
    forcedCut: false,
  }
}

interface PlanConfig {
  maxPartSeconds: number
  silenceOverlapSeconds: number
  forcedOverlapSeconds: number
  minPartSeconds: number
}

function resolveConfig(input: PlanSubFilesInput): PlanConfig {
  return {
    maxPartSeconds: input.maxPartSeconds ?? DEFAULT_MAX_PART_SECONDS,
    silenceOverlapSeconds: input.silenceOverlapSeconds ?? DEFAULT_SILENCE_OVERLAP_SECONDS,
    forcedOverlapSeconds: input.forcedOverlapSeconds ?? DEFAULT_FORCED_OVERLAP_SECONDS,
    minPartSeconds: input.minPartSeconds ?? DEFAULT_MIN_PART_SECONDS,
  }
}

/** Prefer a silence inside the cap; otherwise cut at the cap with a wider overlap. */
function cutFor(input: {
  cursor: number
  limitSec: number
  silenceWindows: readonly SilenceWindow[]
  config: PlanConfig
}): CutPoint {
  const window = silenceCutWithin(
    input.silenceWindows,
    input.cursor,
    input.limitSec,
    input.config.minPartSeconds,
  )
  if (window !== null) {
    return cutAtSilence(window, input.limitSec, input.config.silenceOverlapSeconds)
  }
  return { endSec: input.limitSec, overlapSec: input.config.forcedOverlapSeconds, forcedCut: true }
}

/**
 * The next part starts inside this one; if that is not strictly ahead of the cursor the
 * loop could not terminate, so fall back to a hard cut at the limit.
 */
function guaranteedProgress(cut: CutPoint, cursor: number, limitSec: number): CutPoint {
  return cut.endSec - cut.overlapSec > cursor
    ? cut
    : { endSec: limitSec, overlapSec: 0, forcedCut: true }
}

/**
 * Plan the parts.
 *
 * Guarantees, relied on by the submit route and by cost accounting:
 *  - every part is at most `maxPartSeconds` long;
 *  - the first part starts at 0 and the last ends exactly at `durationSec`;
 *  - parts are contiguous, `next.startSec === previous.endSec - previous.overlapSec`;
 *  - the loop always advances, so a pathological `maxPartSeconds` cannot hang it.
 */
export function planSubFiles(input: PlanSubFilesInput): SubFilePlan[] {
  const durationSec = Number.isFinite(input.durationSec) ? Math.max(0, input.durationSec) : 0
  if (durationSec <= 0) return []

  const config = resolveConfig(input)
  const plans: SubFilePlan[] = []
  let cursor = 0
  let index = 0

  while (durationSec - cursor > config.maxPartSeconds) {
    const limitSec = cursor + config.maxPartSeconds
    const cut = guaranteedProgress(
      cutFor({ cursor, limitSec, silenceWindows: input.silenceWindows, config }),
      cursor,
      limitSec,
    )

    plans.push({
      index,
      startSec: cursor,
      endSec: cut.endSec,
      overlapSec: cut.overlapSec,
      forcedCut: cut.forcedCut,
    })
    cursor = cut.endSec - cut.overlapSec
    index += 1
  }

  plans.push({
    index,
    startSec: cursor,
    endSec: durationSec,
    overlapSec: 0,
    forcedCut: false,
  })

  return plans
}

/** Total audio the provider will be billed for, overlaps included. */
export function totalSubmittedSeconds(plans: readonly SubFilePlan[]): number {
  return plans.reduce((total, plan) => total + (plan.endSec - plan.startSec), 0)
}
