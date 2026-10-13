// fallow-ignore-file unused-export,complexity,code-duplication
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
  env?: { providerUrl?: string; wsTokenSecret?: string }
  buildWsToken?: (sessionId: string) => string
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

export interface SweepStaleSessionsResult {
  stoppedSessions: LiveStyleSessionRecord[]
}

function newSessionId(): string {
  return `ls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** Bill only through the last confirmed heartbeat, not wall clock at stop/sweep time. */
function freezeBillableSecondsAtLastHeartbeat(metering: MeteringState): MeteringState {
  if (metering.meterStartedAtMs === null) return metering
  return tickBillableSeconds(metering, metering.lastHeartbeatAtMs)
}

export async function stopForMissedHeartbeat(
  session: LiveStyleSessionRecord,
  ledger: LiveStylePaymentLedger,
  _nowMs: number,
  env?: { providerUrl?: string },
): Promise<HeartbeatResult> {
  const events: LiveStyleSessionEvent[] = [{ type: 'heartbeat_missed' }]
  let metering = freezeBillableSecondsAtLastHeartbeat(session.metering)
  metering = stopSession(metering, 'heartbeat_missed')

  const finalPull = settleFinalPullUsdc6(metering)
  if (finalPull > 0) {
    const pull = await ledger.pullArrears(session.sessionId, finalPull)
    if (pull.ok) {
      metering = applyPull(metering, pull.amountUsdc6, metering.billedSeconds)
    }
  }

  const provider = getLiveStyleProvider(session.providerId, env ?? {})
  await provider.end(session.providerSession.providerSessionId)

  const stopped: LiveStyleSessionRecord = {
    ...session,
    metering,
    events: [...session.events, ...events, { type: 'stopped', reason: 'heartbeat_missed' }],
  }
  return { session: stopped, events, shouldStop: true }
}

export async function sweepStaleLiveStyleSessions(
  sessions: LiveStyleSessionRecord[],
  ledger: LiveStylePaymentLedger,
  nowMs: number,
  env?: { providerUrl?: string },
): Promise<SweepStaleSessionsResult> {
  const stoppedSessions: LiveStyleSessionRecord[] = []
  for (const session of sessions) {
    if (session.metering.stopped) continue
    if (!shouldStopMissedHeartbeat(session.metering, nowMs, LIVE_STYLE_HEARTBEAT_MISS_MS)) {
      continue
    }
    const result = await stopForMissedHeartbeat(session, ledger, nowMs, env)
    stoppedSessions.push(result.session)
  }
  return { stoppedSessions }
}

export async function createLiveStyleSession(
  input: CreateLiveStyleSessionInput,
): Promise<CreateLiveStyleSessionResult> {
  const sessionId = newSessionId()
  const capUsdc6 = capPresetToUsdc6(input.capPresetUsd)
  const provider = getLiveStyleProvider(input.providerId, input.env ?? {})
  const wsToken = input.buildWsToken?.(sessionId)
  const providerSession = await provider.create({
    sessionId,
    prompt: input.prompt,
    stylePreset: input.stylePreset,
    wsToken,
    wsTokenSecret: input.env?.wsTokenSecret,
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
  const metering = startMeter(session.metering, nowMs)
  return {
    ...session,
    meterActive: true,
    metering: recordHeartbeat(metering, nowMs),
  }
}

function appendCapWarningIfNeeded(
  session: LiveStyleSessionRecord,
  metering: MeteringState,
  events: LiveStyleSessionEvent[],
): void {
  if (!session.meterActive || !shouldWarnLowCap(metering)) return
  if (session.events.some((e) => e.type === 'cap_warning')) return
  events.push({ type: 'cap_warning', remainingSeconds: 120 })
}

function stopForCapOrMaxDuration(
  session: LiveStyleSessionRecord,
  metering: MeteringState,
  nowMs: number,
  events: LiveStyleSessionEvent[],
): HeartbeatResult | null {
  if (session.meterActive && shouldStopCapReached(metering)) {
    events.push({ type: 'cap_reached' })
    const stopped = stopSession(metering, 'cap_reached')
    return {
      session: { ...session, metering: stopped, events: [...session.events, ...events] },
      events,
      shouldStop: true,
    }
  }

  const elapsedSessionSec = Math.floor((nowMs - session.createdAtMs) / 1000)
  if (elapsedSessionSec >= LIVE_STYLE_MAX_SESSION_SECONDS) {
    const stopped = stopSession(metering, 'max_duration')
    events.push({ type: 'stopped', reason: 'max_duration' })
    return {
      session: { ...session, metering: stopped, events: [...session.events, ...events] },
      events,
      shouldStop: true,
    }
  }

  return null
}

async function runArrearsPullIfDue(
  session: LiveStyleSessionRecord,
  metering: MeteringState,
  ledger: LiveStylePaymentLedger,
  nowMs: number,
  events: LiveStyleSessionEvent[],
): Promise<HeartbeatResult | { metering: MeteringState; lastPullAtMs: number }> {
  if (!session.meterActive || nowMs - session.lastPullAtMs < LIVE_STYLE_PAYMENT_PULL_INTERVAL_MS) {
    return { metering, lastPullAtMs: session.lastPullAtMs }
  }

  const delta = computePullDeltaUsdc6(metering)
  if (delta <= 0) {
    return { metering, lastPullAtMs: nowMs }
  }

  const pull = await ledger.pullArrears(session.sessionId, delta)
  if (!pull.ok) {
    events.push({ type: 'pull_failed', error: pull.error ?? 'pull_failed' })
    const stopped = stopSession(metering, 'pull_failed')
    return {
      session: { ...session, metering: stopped, events: [...session.events, ...events] },
      events,
      shouldStop: true,
    }
  }

  return {
    metering: applyPull(metering, pull.amountUsdc6, metering.billedSeconds),
    lastPullAtMs: nowMs,
  }
}

export async function heartbeatLiveStyleSession(
  session: LiveStyleSessionRecord,
  ledger: LiveStylePaymentLedger,
  nowMs: number,
  env?: { providerUrl?: string },
): Promise<HeartbeatResult> {
  if (session.metering.stopped) {
    return { session, events: [], shouldStop: true }
  }

  if (shouldStopMissedHeartbeat(session.metering, nowMs, LIVE_STYLE_HEARTBEAT_MISS_MS)) {
    return stopForMissedHeartbeat(session, ledger, nowMs, env)
  }

  const events: LiveStyleSessionEvent[] = []
  let metering = session.metering
  if (session.meterActive) {
    metering = tickBillableSeconds(metering, nowMs)
  }
  metering = recordHeartbeat(metering, nowMs)

  appendCapWarningIfNeeded(session, metering, events)

  const limitStop = stopForCapOrMaxDuration(session, metering, nowMs, events)
  if (limitStop) return limitStop

  const pullResult = await runArrearsPullIfDue(session, metering, ledger, nowMs, events)
  if ('shouldStop' in pullResult) return pullResult

  return {
    session: {
      ...session,
      metering: pullResult.metering,
      lastPullAtMs: pullResult.lastPullAtMs,
      events: [...session.events, ...events],
    },
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
  const nowMs = Date.now()
  let metering = tickBillableSeconds(session.metering, nowMs)
  metering = stopSession(metering, reason)
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
