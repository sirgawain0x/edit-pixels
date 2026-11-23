import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FRAME_SECONDS,
  FrameEnergyAccumulator,
  frameEnergies,
  silenceWindows,
  type SilenceWindow,
} from './silence-detect'

const SAMPLE_RATE = 16_000

/** `seconds` of a tone at `amplitude`, then `silenceSeconds` of digital zero. */
function toneThenSilence(seconds: number, amplitude: number, silenceSeconds: number): Float32Array {
  const toneSamples = Math.round(seconds * SAMPLE_RATE)
  const silenceSamples = Math.round(silenceSeconds * SAMPLE_RATE)
  const samples = new Float32Array(toneSamples + silenceSamples)
  for (let index = 0; index < toneSamples; index++) {
    // 440 Hz at the given amplitude: loud enough to sit well above the silence threshold.
    samples[index] = amplitude * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE)
  }
  return samples
}

describe('frameEnergies', () => {
  it('reports roughly -6 dBFS for a full-scale sine and the floor for silence', () => {
    const samples = toneThenSilence(1, 1, 1)
    const energies = frameEnergies(samples, SAMPLE_RATE)

    expect(energies.length).toBe(20)
    // RMS of a unit sine is 1/sqrt(2), i.e. about -3 dB; allow for frame alignment.
    expect(energies[0]).toBeGreaterThan(-6)
    expect(energies[0]).toBeLessThan(0)
    // Digital silence must stay finite so downstream arithmetic cannot produce NaN.
    expect(energies.at(-1)).toBe(-100)
  })

  it('drops a trailing partial frame instead of zero-padding it', () => {
    // 0.15 s at 100 ms frames: one whole frame plus a leftover that must not appear as
    // silence, which would manufacture a cut point at the end of the file.
    const energies = frameEnergies(new Float32Array(SAMPLE_RATE * 0.15), SAMPLE_RATE)
    expect(energies.length).toBe(1)
  })

  it('uses 100 ms frames by default', () => {
    const energies = frameEnergies(new Float32Array(SAMPLE_RATE * 2), SAMPLE_RATE)
    expect(energies.length).toBe(2 / DEFAULT_FRAME_SECONDS)
  })
})

describe('FrameEnergyAccumulator', () => {
  it('measures the same frames whether or not the audio arrives in pieces', () => {
    const samples = toneThenSilence(1, 0.5, 1)
    const whole = frameEnergies(samples, SAMPLE_RATE)

    // Feed in ragged chunks that cut through frame boundaries.
    const accumulator = new FrameEnergyAccumulator(SAMPLE_RATE)
    for (let offset = 0; offset < samples.length; offset += 1234) {
      accumulator.push(samples.subarray(offset, Math.min(offset + 1234, samples.length)))
    }
    const streamed = accumulator.finish()

    expect(streamed.length).toBe(whole.length)
    for (let index = 0; index < whole.length; index++) {
      expect(streamed[index]).toBeCloseTo(whole[index]!, 4)
    }
  })

  it('drops a trailing partial frame, so the end of the audio is not read as silence', () => {
    const accumulator = new FrameEnergyAccumulator(SAMPLE_RATE)
    accumulator.push(new Float32Array(SAMPLE_RATE * 0.15))

    expect(accumulator.finish().length).toBe(1)
    expect(accumulator.processedSamples).toBe(SAMPLE_RATE / 10)
  })
})

describe('silenceWindows', () => {
  it('finds the gap between two spoken stretches', () => {
    const samples = toneThenSilence(1, 0.5, 1)
    const energies = frameEnergies(samples, SAMPLE_RATE)
    const windows = silenceWindows(energies)

    expect(windows).toHaveLength(1)
    expect(windows[0]!.startSec).toBeCloseTo(1, 1)
    expect(windows[0]!.endSec).toBeCloseTo(2, 1)
  })

  it('ignores gaps too short to hold the overlap', () => {
    // 200 ms is below the 400 ms floor: cutting there would leave no room for the cushion.
    const samples = toneThenSilence(1, 0.5, 0.2)
    const energies = frameEnergies(samples, SAMPLE_RATE)

    expect(silenceWindows(energies)).toEqual([])
    expect(
      silenceWindows(energies, DEFAULT_FRAME_SECONDS, { minSilenceSeconds: 0.1 }),
    ).toHaveLength(1)
  })

  it('treats quiet room tone as silence but not a quiet syllable', () => {
    const roomTone = toneThenSilence(1, 0.5, 1)
    const energies = frameEnergies(roomTone, SAMPLE_RATE)
    expect(silenceWindows(energies, DEFAULT_FRAME_SECONDS, { thresholdDb: -40 })).toHaveLength(1)

    // A 0.4-amplitude tone is about -11 dBFS: no threshold here may call it silence.
    const quiet = toneThenSilence(1, 0.4, 1)
    const quietEnergies = frameEnergies(quiet, SAMPLE_RATE)
    const windows: SilenceWindow[] = silenceWindows(quietEnergies)
    expect(windows).toHaveLength(1)
    expect(windows[0]!.startSec).toBeGreaterThanOrEqual(0.9)
  })

  it('reports nothing for audio that is silent throughout only when it is too short', () => {
    // All-silent audio is one long window, which the planner then refuses to cut in.
    const energies = frameEnergies(new Float32Array(SAMPLE_RATE * 3), SAMPLE_RATE)
    expect(silenceWindows(energies)).toEqual([{ startSec: 0, endSec: 3 }])
  })
})
