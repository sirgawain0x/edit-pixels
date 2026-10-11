// @vitest-environment node
import { describe, expect, it } from 'vite-plus/test'
import {
  applyPull,
  computePullDeltaUsdc6,
  createMeteringState,
  shouldStopCapReached,
  shouldWarnLowCap,
  startMeter,
  tickBillableSeconds,
  trueUpPullBalances,
  usdc6ForSeconds,
} from './metering'

describe('live-style metering', () => {
  it('warm-up is free until meter starts', () => {
    const t0 = 1_000_000
    let state = createMeteringState({ createdAtMs: t0, capUsdc6: 1_000_000, isPremium: false })
    state = tickBillableSeconds(state, t0 + 120_000)
    expect(state.billedSeconds).toBe(0)
    state = startMeter(state, t0 + 5_000)
    state = tickBillableSeconds(state, t0 + 65_000)
    expect(state.billedSeconds).toBe(60)
  })

  it('charges retail rate per second ceiling', () => {
    expect(usdc6ForSeconds(60, 100_000)).toBe(100_000)
    expect(usdc6ForSeconds(30, 100_000)).toBe(50_000)
  })

  it('stops at cap', () => {
    const t0 = 0
    let state = createMeteringState({ createdAtMs: t0, capUsdc6: 100_000, isPremium: false })
    state = startMeter(state, t0)
    state = { ...state, billedSeconds: 60 }
    expect(shouldStopCapReached(state)).toBe(true)
  })

  it('warns when 2 minutes of cap remain', () => {
    const t0 = 0
    let state = createMeteringState({ createdAtMs: t0, capUsdc6: 3_000_000, isPremium: false })
    state = startMeter(state, t0)
    state = { ...state, billedSeconds: 60 * 28 }
    expect(shouldWarnLowCap(state)).toBe(true)
  })

  it('pull delta respects cap', () => {
    let state = createMeteringState({ createdAtMs: 0, capUsdc6: 50_000, isPremium: false })
    state = startMeter(state, 0)
    state = { ...state, billedSeconds: 60 }
    expect(computePullDeltaUsdc6(state)).toBe(50_000)
    state = applyPull(state, 50_000, 60)
    expect(computePullDeltaUsdc6(state)).toBe(0)
  })

  it('true-up adjusts pulled balance', () => {
    expect(trueUpPullBalances(100_000, 10_000, 0)).toBe(90_000)
    expect(trueUpPullBalances(100_000, 0, 5_000)).toBe(105_000)
  })
})
