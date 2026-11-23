import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_PART_SECONDS,
  planSubFiles,
  totalSubmittedSeconds,
  type SubFilePlan,
} from './plan-subfiles'

/** Every gap between 0 and `durationSec`, `gapSec` long, every `everySec`. */
function regularSilences(durationSec: number, everySec: number, gapSec: number) {
  const windows: Array<{ startSec: number; endSec: number }> = []
  for (let at = everySec; at < durationSec; at += everySec) {
    windows.push({ startSec: at, endSec: Math.min(at + gapSec, durationSec) })
  }
  return windows
}

function expectContiguous(plans: SubFilePlan[], durationSec: number): void {
  expect(plans[0]!.startSec).toBe(0)
  expect(plans.at(-1)!.endSec).toBeCloseTo(durationSec, 6)
  expect(plans.at(-1)!.overlapSec).toBe(0)
  for (let index = 1; index < plans.length; index++) {
    const previous = plans[index - 1]!
    const current = plans[index]!
    // The next part starts inside the previous one, which is what makes the overlap shared.
    expect(current.startSec).toBeCloseTo(previous.endSec - previous.overlapSec, 6)
    expect(current.index).toBe(index)
  }
}

function expectWithinCap(plans: SubFilePlan[], maxSec: number): void {
  for (const plan of plans) {
    expect(plan.endSec - plan.startSec).toBeLessThanOrEqual(maxSec + 1e-6)
    expect(plan.endSec).toBeGreaterThan(plan.startSec)
  }
}

describe('planSubFiles', () => {
  it('returns one part when the audio fits under the cap', () => {
    const plans = planSubFiles({ durationSec: 60, silenceWindows: [] })

    expect(plans).toEqual([{ index: 0, startSec: 0, endSec: 60, overlapSec: 0, forcedCut: false }])
    expect(totalSubmittedSeconds(plans)).toBe(60)
  })

  it('returns nothing for empty or nonsense durations', () => {
    expect(planSubFiles({ durationSec: 0, silenceWindows: [] })).toEqual([])
    expect(planSubFiles({ durationSec: -5, silenceWindows: [] })).toEqual([])
    expect(planSubFiles({ durationSec: Number.NaN, silenceWindows: [] })).toEqual([])
  })

  it('splits a long file and never exceeds the cap', () => {
    const durationSec = 3 * 60 * 60
    const plans = planSubFiles({
      durationSec,
      silenceWindows: regularSilences(durationSec, 17 * 60, 3),
    })

    expect(plans.length).toBeGreaterThan(8)
    expectWithinCap(plans, DEFAULT_MAX_PART_SECONDS)
    expectContiguous(plans, durationSec)
  })

  it('cuts inside a silence rather than at the cap', () => {
    // Silence sits at 600-606 s; the cap would otherwise land at 1199.5 s.
    const plans = planSubFiles({
      durationSec: 1500,
      silenceWindows: [{ startSec: 600, endSec: 606 }],
    })

    expect(plans[0]!.forcedCut).toBe(false)
    // Midpoint of the silence, plus half the cushion.
    expect(plans[0]!.endSec).toBeCloseTo(603.15, 6)
    expect(plans[0]!.overlapSec).toBe(0.3)
  })

  it('prefers the latest silence that fits, to keep parts full', () => {
    const plans = planSubFiles({
      durationSec: 2000,
      silenceWindows: [
        { startSec: 200, endSec: 206 },
        { startSec: 900, endSec: 906 },
        { startSec: 1180, endSec: 1186 },
      ],
    })

    expect(plans[0]!.endSec).toBeCloseTo(1183.15, 6)
  })

  it('ignores a silence that would start the part too early', () => {
    // A gap at 5 s would make a 5-second first part; the 30 s floor skips it.
    const plans = planSubFiles({
      durationSec: 2400,
      silenceWindows: [{ startSec: 5, endSec: 12 }],
    })

    expect(plans[0]!.forcedCut).toBe(true)
    expect(plans[0]!.endSec).toBeCloseTo(DEFAULT_MAX_PART_SECONDS, 6)
  })

  it('ignores a silence that would overrun the cap', () => {
    const plans = planSubFiles({
      durationSec: 2400,
      silenceWindows: [{ startSec: 1195, endSec: 1210 }],
    })

    expect(plans[0]!.forcedCut).toBe(true)
    expectWithinCap(plans, DEFAULT_MAX_PART_SECONDS)
  })

  it('forces a mid-speech cut with a wider overlap when there is no silence at all', () => {
    const durationSec = 2500
    const plans = planSubFiles({ durationSec, silenceWindows: [] })

    expect(plans[0]!.forcedCut).toBe(true)
    expect(plans[0]!.overlapSec).toBe(2)
    expect(plans.every((plan) => plan.forcedCut || plan.index === plans.length - 1)).toBe(true)
    expectContiguous(plans, durationSec)
  })

  it('stays contiguous when the audio is silence only', () => {
    // A fully silent file is one huge window; the planner must not try to cut inside it.
    const plans = planSubFiles({
      durationSec: 30 * 60,
      silenceWindows: [{ startSec: 0, endSec: 30 * 60 }],
    })

    expect(plans.every((plan) => plan.forcedCut || plan.index === plans.length - 1)).toBe(true)
    expectContiguous(plans, 30 * 60)
    expectWithinCap(plans, DEFAULT_MAX_PART_SECONDS)
  })

  it('always advances, even with a pathological cap', () => {
    const plans = planSubFiles({
      durationSec: 10,
      maxPartSeconds: 1,
      minPartSeconds: 0,
      silenceWindows: [{ startSec: 0, endSec: 10 }],
    })

    expect(plans.length).toBeGreaterThan(1)
    expectContiguous(plans, 10)
    expectWithinCap(plans, 1)
  })

  it('counts the overlaps as billable audio, which is why the total exceeds the duration', () => {
    const durationSec = 2500
    const plans = planSubFiles({ durationSec, silenceWindows: [] })

    // 2500 s over a ~1200 s cap needs two forced cuts, so 2 × 2 s of audio is submitted twice.
    expect(plans.filter((plan) => plan.forcedCut)).toHaveLength(2)
    expect(totalSubmittedSeconds(plans)).toBeGreaterThan(durationSec)
    expect(totalSubmittedSeconds(plans) - durationSec).toBeCloseTo(4, 6)
  })
})
