import {
  LIVE_STYLE_HEARTBEAT_MISS_MS,
  LIVE_STYLE_MAX_SESSION_SECONDS,
  LIVE_STYLE_PAYMENT_PULL_INTERVAL_MS,
  type LiveStyleCapPresetUsd,
  type LiveStyleProviderId,
  capPresetToUsdc6,
} from './config'
import {
  applyPull,
  computePullDeltaUsdc6,
  createMeteringState,
  recordHeartbeat,
  settleFinalPullUsdc6,
  shouldStopCapReached,
  shouldStopMissedHeartbeat,
  shouldWarnLowCap,
  startMeter,
  stopSession,
  tickBillableSeconds,
  type MeteringState,
} from './metering'
import type { LiveStylePaymentLedger } from './payment/types'
import { getLiveStyleProvider } from './providers/registry'
import type { LiveStyleProviderSession } from './providers/types'
import type { LiveStyleTransportConnectInfo } from './transport'

export interface LiveStyleSessionRecord {
  sessionId: string
  wallet: string
  providerId: LiveStyleProviderId
  metering: MeteringState
  providerSession: LiveStyleProviderSession
  createdAtMs: number
  lastPullAtMs: number
  meterActive: boolean
  events: LiveStyleSessionEvent[]
}

export type LiveStyleSessionEvent =
  | { type: 'cap_warning'; remainingSeconds: number }
  | { type: 'cap_reached' }
  | { type: 'pull_failed'; error: string }
  | { type: 'heartbeat_missed' }
  | { type: 'stopped'; reason: string }

export interface CreateLiveStyleSessionInput {
  wallet: string
  providerId: LiveStyleProviderId
  capPresetUsd: LiveStyleCapPresetUsd
  isPremium: boolean
  prompt?: string
  stylePreset?: string
  nowMs: number
  env?: { providerUrl?: string }
}

export interface CreateLiveStyleSessionResult {
  session: LiveStyleSessionRecord
  connect: LiveStyleTransportConnectInfo
  maxBillableSeconds: number
}

export interface HeartbeatResult {
  session: LiveStyleSessionRecord
  events: LiveStyleSessionEvent[]
  shouldStop: boolean
}

function newSessionId(): string {
  return `ls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export async function createLiveStyleSession(
  input: CreateLiveStyleSessionInput,
): Promise<CreateLiveStyleSessionResult> {
  const sessionId = newSessionId()
  const capUsdc6 = capPresetToUsdc6(input.capPresetUsd)
  const provider = getLiveStyleProvider(input.providerId, input.env ?? {})
  const providerSession = await provider.create({
    sessionId,
    prompt: input.prompt,
    stylePreset: input.stylePreset,
  })

  const metering = createMeteringState({
    createdAtMs: input.nowMs,
    capUsdc6,
    isPremium: input.isPremium,
  })

  const session: LiveStyleSessionRecord = {
    sessionId,
    wallet: input.wallet.toLowerCase(),
    providerId: input.providerId,
    metering,
    providerSession,
    createdAtMs: input.nowMs,
    lastPullAtMs: input.nowMs,
    meterActive: false,
    events: [],
  }

  const perMin = input.isPremium ? 80_000 : 100_000
  const maxBillableSeconds = Math.floor((capUsdc6 * 60) / perMin)

  return {
    session,
    connect: providerSession.connect,
    maxBillableSeconds: Math.min(maxBillableSeconds, LIVE_STYLE_MAX_SESSION_SECONDS),
  }
}

export function markMeterStarted(
  session: LiveStyleSessionRecord,
  nowMs: number,
): LiveStyleSessionRecord {
  return {
    ...session,
    meterActive: true,
    metering: startMeter(session.metering, nowMs),
  }
}

export async function heartbeatLiveStyleSession(
  session: LiveStyleSessionRecord,
  ledger: LiveStylePaymentLedger,
  nowMs: number,
): Promise<HeartbeatResult> {
  const events: LiveStyleSessionEvent[] = []
  let metering = recordHeartbeat(tickBillableSeconds(session.metering, nowMs), nowMs)
  let current: LiveStyleSessionRecord = { ...session, metering }

  if (session.meterActive) {
    metering = tickBillableSeconds(metering, nowMs)
    current = { ...current, metering }
  }

  if (shouldStopMissedHeartbeat(metering, nowMs, LIVE_STYLE_HEARTBEAT_MISS_MS)) {
    events.push({ type: 'heartbeat_missed' })
    metering = stopSession(metering, 'heartbeat_missed')
    current = { ...current, metering, events: [...current.events, ...events] }
    return { session: current, events, shouldStop: true }
  }

  if (session.meterActive && shouldWarnLowCap(metering)) {
    const warn = { type: 'cap_warning' as const, remainingSeconds: 120 }
    if (!session.events.some((e) => e.type === 'cap_warning')) {
      events.push(warn)
    }
  }

  if (session.meterActive && shouldStopCapReached(metering)) {
    events.push({ type: 'cap_reached' })
    metering = stopSession(metering, 'cap_reached')
    current = { ...current, metering }
    return { session: { ...current, events: [...current.events, ...events] }, events, shouldStop: true }
  }

  const elapsedSessionSec = Math.floor((nowMs - session.createdAtMs) / 1000)
  if (elapsedSessionSec >= LIVE_STYLE_MAX_SESSION_SECONDS) {
    metering = stopSession(metering, 'max_duration')
    events.push({ type: 'stopped', reason: 'max_duration' })
    current = { ...current, metering }
    return { session: { ...current, events: [...current.events, ...events] }, events, shouldStop: true }
  }

  if (
    session.meterActive &&
    nowMs - session.lastPullAtMs >= LIVE_STYLE_PAYMENT_PULL_INTERVAL_MS
  ) {
    const delta = computePullDeltaUsdc6(metering)
    if (delta > 0) {
      const pull = await ledger.pullArrears(session.sessionId, delta)
      if (pull.ok) {
        metering = applyPull(metering, pull.amountUsdc6, metering.billedSeconds)
        current = { ...current, metering, lastPullAtMs: nowMs }
      } else {
        events.push({ type: 'pull_failed', error: pull.error ?? 'pull_failed' })
        metering = stopSession(metering, 'pull_failed')
        current = { ...current, metering }
        return {
          session: { ...current, events: [...current.events, ...events] },
          events,
          shouldStop: true,
        }
      }
    } else {
      current = { ...current, lastPullAtMs: nowMs }
    }
  }

  return {
    session: { ...current, events: [...current.events, ...events] },
    events,
    shouldStop: false,
  }
}

export async function stopLiveStyleSession(
  session: LiveStyleSessionRecord,
  ledger: LiveStylePaymentLedger,
  reason: string,
  env?: { providerUrl?: string },
): Promise<LiveStyleSessionRecord> {
  let metering = stopSession(tickBillableSeconds(session.metering, Date.now()), reason)
  const finalPull = settleFinalPullUsdc6(metering)
  if (finalPull > 0) {
    const pull = await ledger.pullArrears(session.sessionId, finalPull)
    if (pull.ok) {
      metering = applyPull(metering, pull.amountUsdc6, metering.billedSeconds)
    }
  }

  const provider = getLiveStyleProvider(session.providerId, env ?? {})
  await provider.end(session.providerSession.providerSessionId)

  return { ...session, metering, events: [...session.events, { type: 'stopped', reason }] }
}
