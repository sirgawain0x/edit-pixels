/**
 * Silence analysis for the cloud transcription planner.
 *
 * The planner may only cut where nobody is talking: a cut through a word costs the user
 * the word (or half of it), and the model cannot recover audio it never received. This
 * module turns PCM into per-frame loudness and then into silence windows, which is all
 * the cut logic needs.
 *
 * Frames are 100 ms: short enough to find a pause between sentences, long enough that a
 * single glottal stop does not read as silence.
 */

/** 100 ms frames. */
export const DEFAULT_FRAME_SECONDS = 0.1

/**
 * dBFS below which a frame counts as silence. Speech recorded at normal levels sits
 * around -20 to -30 dBFS; -45 dBFS is room tone rather than a quiet syllable.
 */
const DEFAULT_SILENCE_THRESHOLD_DB = -45

/** A pause shorter than this is not a usable cut point — there is no room for the overlap. */
const DEFAULT_MIN_SILENCE_SECONDS = 0.4

/** Digital silence would be -Infinity; clamp so arithmetic downstream stays finite. */
const FLOOR_DB = -100

export interface SilenceWindow {
  startSec: number
  endSec: number
}

/** Root-mean-square level of one frame, in dBFS. */
function frameDb(samples: Float32Array, from: number, to: number): number {
  let sum = 0
  for (let index = from; index < to; index++) {
    const value = samples[index] ?? 0
    sum += value * value
  }
  const rms = Math.sqrt(sum / Math.max(1, to - from))
  if (rms <= 0) return FLOOR_DB
  return Math.max(FLOOR_DB, 20 * Math.log10(rms))
}

/**
 * Per-frame loudness in dBFS.
 *
 * A trailing partial frame is dropped rather than zero-padded: padding would append a
 * fake silent frame and could manufacture a cut point at the very end of the audio.
 */
export function frameEnergies(
  samples: Float32Array,
  sampleRate: number,
  frameSeconds = DEFAULT_FRAME_SECONDS,
): Float32Array {
  const frameSamples = Math.max(1, Math.round(sampleRate * frameSeconds))
  const frameCount = Math.floor(samples.length / frameSamples)
  const energies = new Float32Array(frameCount)
  for (let frame = 0; frame < frameCount; frame++) {
    const from = frame * frameSamples
    energies[frame] = frameDb(samples, from, from + frameSamples)
  }
  return energies
}

export interface SilenceOptions {
  thresholdDb?: number
  minSilenceSeconds?: number
}

/**
 * Same measurement as `frameEnergies`, but fed chunk by chunk.
 *
 * The planner decodes twice — once to find the pauses, once to cut the parts — so the
 * first pass must not retain audio. An eight-hour source is 1.8 GB of Float32 PCM; its
 * energy profile is 288k floats, about a megabyte.
 */
export class FrameEnergyAccumulator {
  private readonly frameSeconds: number
  private readonly frameSamples: number
  private readonly energies: number[] = []
  private pending: Float32Array = new Float32Array(0)

  constructor(sampleRate: number, frameSeconds = DEFAULT_FRAME_SECONDS) {
    this.frameSeconds = frameSeconds
    this.frameSamples = Math.max(1, Math.round(sampleRate * frameSeconds))
  }

  push(samples: Float32Array): void {
    if (samples.length === 0) return

    // Keep the previous partial frame so frames straddling a chunk boundary are measured
    // as one frame rather than as a short loud one followed by a short loud one.
    const merged = new Float32Array(this.pending.length + samples.length)
    merged.set(this.pending, 0)
    merged.set(samples, this.pending.length)

    const wholeFrames = Math.floor(merged.length / this.frameSamples)
    for (let frame = 0; frame < wholeFrames; frame++) {
      const from = frame * this.frameSamples
      this.energies.push(frameDb(merged, from, from + this.frameSamples))
    }

    const consumed = wholeFrames * this.frameSamples
    this.pending = merged.slice(consumed)
  }

  /** Whole frames only; a trailing partial frame is dropped, as in `frameEnergies`. */
  finish(): Float32Array {
    return Float32Array.from(this.energies)
  }

  get frameWindowSeconds(): number {
    return this.frameSeconds
  }

  get processedSamples(): number {
    return this.energies.length * this.frameSamples
  }
}

/** A frame counts as silent when it is below the threshold; missing frames are treated as floor. */
function isSilentFrame(energies: Float32Array, frame: number, thresholdDb: number): boolean {
  return (energies[frame] ?? FLOOR_DB) < thresholdDb
}

/**
 * Contiguous runs of frames below the threshold, in seconds.
 *
 * Runs shorter than `minSilenceSeconds` are dropped: a cut needs somewhere to put the
 * overlap, and a 200 ms gap between words gives it nothing.
 */
export function silenceWindows(
  energies: Float32Array,
  frameSeconds = DEFAULT_FRAME_SECONDS,
  options: SilenceOptions = {},
): SilenceWindow[] {
  const thresholdDb = options.thresholdDb ?? DEFAULT_SILENCE_THRESHOLD_DB
  const minSilenceSeconds = options.minSilenceSeconds ?? DEFAULT_MIN_SILENCE_SECONDS
  const windows: SilenceWindow[] = []
  let runStart = -1

  const closeRun = (endFrame: number): void => {
    if (runStart < 0) return
    const startSec = runStart * frameSeconds
    const endSec = endFrame * frameSeconds
    if (endSec - startSec >= minSilenceSeconds) windows.push({ startSec, endSec })
    runStart = -1
  }

  for (let frame = 0; frame < energies.length; frame++) {
    if (isSilentFrame(energies, frame, thresholdDb)) {
      if (runStart < 0) runStart = frame
      continue
    }
    closeRun(frame)
  }
  closeRun(energies.length)

  return windows
}
