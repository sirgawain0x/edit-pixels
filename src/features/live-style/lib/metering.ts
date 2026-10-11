/**
 * Server-measured Live Style metering (warm-up is free; billable seconds only after meter start).
 */

import {
  LIVE_STYLE_CAP_WARN_REMAINING_SECONDS,
  LIVE_STYLE_USDC6_PER_MINUTE_PREMIUM,
  LIVE_STYLE_USDC6_PER_MINUTE_RETAIL,
  usdc6PerMinuteForPremium,
} from './config'

export interface MeteringState {
  /** Wall-clock when the session record was created. */
  createdAtMs: number
  /** When billable metering started (first styled frame). Null until started. */
  meterStartedAtMs: number | null
  /** Cumulative billable seconds (server authority). */
  billedSeconds: number
  /** USDC6 already pulled on-chain or marked settled. */
  pulledUsdc6: number
  /** Authorized spend cap for this session (USDC6). */
  capUsdc6: number
  isPremium: boolean
  /** Last successful client heartbeat (wall clock). */
  lastHeartbeatAtMs: number
  /** Last payment pull boundary (billable seconds at last pull). */
  lastPullAtBilledSeconds: number
  stopped: boolean
  stopReason: string | null
}

export function createMeteringState(input: {
  createdAtMs: number
  capUsdc6: number
  isPremium: boolean
}): MeteringState {
  return {
    createdAtMs: input.createdAtMs,
    meterStartedAtMs: null,
    billedSeconds: 0,
    pulledUsdc6: 0,
    capUsdc6: input.capUsdc6,
    isPremium: input.isPremium,
    lastHeartbeatAtMs: input.createdAtMs,
    lastPullAtBilledSeconds: 0,
    stopped: false,
    stopReason: null,
  }
}

export function usdc6PerMinute(state: MeteringState): number {
  return usdc6PerMinuteForPremium(state.isPremium)
}

export function usdc6ForSeconds(seconds: number, usdc6PerMin: number): number {
  if (seconds <= 0) return 0
  return Math.ceil((seconds * usdc6PerMin) / 60)
}

export function startMeter(state: MeteringState, nowMs: number): MeteringState {
  if (state.meterStartedAtMs !== null) return state
  return { ...state, meterStartedAtMs: nowMs }
}

/** Advance billed seconds from meter start to `nowMs` (idempotent tick). */
export function tickBillableSeconds(state: MeteringState, nowMs: number): MeteringState {
  if (state.stopped || state.meterStartedAtMs === null) return state
  const elapsedSec = Math.max(0, Math.floor((nowMs - state.meterStartedAtMs) / 1000))
  if (elapsedSec <= state.billedSeconds) return state
  return { ...state, billedSeconds: elapsedSec }
}

export function totalOwedUsdc6(state: MeteringState): number {
  return usdc6ForSeconds(state.billedSeconds, usdc6PerMinute(state))
}

export function remainingCapUsdc6(state: MeteringState): number {
  return Math.max(0, state.capUsdc6 - state.pulledUsdc6)
}

export function capRemainingSeconds(state: MeteringState): number {
  const perMin = usdc6PerMinute(state)
  const remaining = remainingCapUsdc6(state)
  const owed = totalOwedUsdc6(state)
  const headroomUsdc6 = Math.max(0, remaining - (owed - state.pulledUsdc6))
  if (perMin <= 0) return 0
  return Math.floor((headroomUsdc6 * 60) / perMin)
}

export function shouldWarnLowCap(state: MeteringState): boolean {
  if (state.stopped || state.meterStartedAtMs === null) return false
  return capRemainingSeconds(state) <= LIVE_STYLE_CAP_WARN_REMAINING_SECONDS
}

export function shouldStopCapReached(state: MeteringState): boolean {
  return totalOwedUsdc6(state) >= state.capUsdc6 && state.capUsdc6 > 0
}

export function shouldStopMissedHeartbeat(state: MeteringState, nowMs: number, missMs: number): boolean {
  return nowMs - state.lastHeartbeatAtMs > missMs
}

export function recordHeartbeat(state: MeteringState, nowMs: number): MeteringState {
  return { ...state, lastHeartbeatAtMs: nowMs }
}

export function stopSession(state: MeteringState, reason: string): MeteringState {
  return { ...state, stopped: true, stopReason: reason }
}

/** Amount to pull since last pull (arrears), capped by remaining authorization. */
export function computePullDeltaUsdc6(state: MeteringState): number {
  const owed = totalOwedUsdc6(state)
  const delta = owed - state.pulledUsdc6
  const capped = Math.min(delta, remainingCapUsdc6(state))
  return Math.max(0, capped)
}

/** On session stop, settle any un-pulled owed amount (partial minute). */
export function settleFinalPullUsdc6(state: MeteringState): number {
  return computePullDeltaUsdc6(state)
}

export function applyPull(state: MeteringState, amountUsdc6: number, atBilledSeconds: number): MeteringState {
  return {
    ...state,
    pulledUsdc6: state.pulledUsdc6 + amountUsdc6,
    lastPullAtBilledSeconds: atBilledSeconds,
  }
}

/**
 * If a pull failed after meter advanced, or over-pulled, adjust next pull.
 * `overpullUsdc6` is credited back; `underpullUsdc6` is added to next pull.
 */
export function trueUpPullBalances(
  pulledUsdc6: number,
  overpullUsdc6: number,
  underpullUsdc6: number,
): number {
  return Math.max(0, pulledUsdc6 - overpullUsdc6 + underpullUsdc6)
}

export function retailAndPremiumRatesMatchConstants(): boolean {
  return (
    LIVE_STYLE_USDC6_PER_MINUTE_RETAIL === 100_000 &&
    LIVE_STYLE_USDC6_PER_MINUTE_PREMIUM === 80_000
  )
}
