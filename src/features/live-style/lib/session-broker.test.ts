// @vitest-environment node
import { describe, expect, it } from 'vite-plus/test'
import { LIVE_STYLE_HEARTBEAT_MISS_MS } from './config'
import { shouldStopMissedHeartbeat } from './metering'
import { createInMemoryLiveStylePaymentLedger } from './payment/in-memory-ledger'
import type { LiveStyleSpendAuthorization } from './payment/types'
import {
  createLiveStyleSession,
  heartbeatLiveStyleSession,
  markMeterStarted,
  stopForMissedHeartbeat,
  sweepStaleLiveStyleSessions,
  stopLiveStyleSession,
} from './session-broker'

describe('live-style session broker', () => {
  it('mock provider end-to-end with heartbeat and stop', async () => {
    const ledger = createInMemoryLiveStylePaymentLedger()
    const t0 = 1_700_000_000_000
    const { session, connect } = await createLiveStyleSession({
      wallet: '0xabc0000000000000000000000000000000000001',
      providerId: 'mock',
      capPresetUsd: 1,
      isPremium: false,
      nowMs: t0,
    })
    expect(connect.kind).toBe('websocket')

    await ledger.recordAuthorization({
      sessionId: session.sessionId,
      wallet: session.wallet,
      capUsdc6: 1_000_000,
      method: 'erc20-approve',
      proof: '0xmock',
      createdAtMs: t0,
    })

    let current = markMeterStarted(session, t0 + 1_000)
    const hb = await heartbeatLiveStyleSession(current, ledger, t0 + 11_000)
    expect(hb.shouldStop).toBe(false)

    const stopped = await stopLiveStyleSession(hb.session, ledger, 'user_stop')
    expect(stopped.metering.stopped).toBe(true)
  })

  it('auto-stops when cap reached', async () => {
    const ledger = createInMemoryLiveStylePaymentLedger()
    const t0 = 0
    const { session } = await createLiveStyleSession({
      wallet: '0xabc0000000000000000000000000000000000002',
      providerId: 'mock',
      capPresetUsd: 1,
      isPremium: false,
      nowMs: t0,
    })
    await ledger.recordAuthorization({
      sessionId: session.sessionId,
      wallet: session.wallet,
      capUsdc6: 100_000,
      method: 'erc20-approve',
      proof: '0xmock',
      createdAtMs: t0,
    } satisfies LiveStyleSpendAuthorization)

    let current = markMeterStarted(session, t0 - 60_000)
    current = {
      ...current,
      metering: {
        ...current.metering,
        capUsdc6: 100_000,
        lastHeartbeatAtMs: t0 - 5_000,
      },
      meterActive: true,
    }
    const hb = await heartbeatLiveStyleSession(current, ledger, t0)
    expect(hb.shouldStop).toBe(true)
    expect(hb.events.some((e) => e.type === 'cap_reached')).toBe(true)
  })

  it('does not treat gap equal to threshold as missed', () => {
    const lastHb = 1_000_000
    const metering = {
      createdAtMs: lastHb,
      meterStartedAtMs: lastHb,
      billedSeconds: 0,
      pulledUsdc6: 0,
      capUsdc6: 1_000_000,
      isPremium: false,
      lastHeartbeatAtMs: lastHb,
      lastPullAtBilledSeconds: 0,
      stopped: false,
      stopReason: null,
    }
    expect(
      shouldStopMissedHeartbeat(metering, lastHb + LIVE_STYLE_HEARTBEAT_MISS_MS, LIVE_STYLE_HEARTBEAT_MISS_MS),
    ).toBe(false)
    expect(
      shouldStopMissedHeartbeat(
        metering,
        lastHb + LIVE_STYLE_HEARTBEAT_MISS_MS + 1,
        LIVE_STYLE_HEARTBEAT_MISS_MS,
      ),
    ).toBe(true)
  })

  it('stops late heartbeat when gap exceeds threshold', async () => {
    const ledger = createInMemoryLiveStylePaymentLedger()
    const t0 = 0
    const { session } = await createLiveStyleSession({
      wallet: '0xabc0000000000000000000000000000000000003',
      providerId: 'mock',
      capPresetUsd: 1,
      isPremium: false,
      nowMs: t0,
    })
    await ledger.recordAuthorization({
      sessionId: session.sessionId,
      wallet: session.wallet,
      capUsdc6: 1_000_000,
      method: 'erc20-approve',
      proof: '0xmock',
      createdAtMs: t0,
    })

    const started = markMeterStarted(session, t0)
    const late = await heartbeatLiveStyleSession(
      started,
      ledger,
      t0 + LIVE_STYLE_HEARTBEAT_MISS_MS + 5_000,
    )
    expect(late.shouldStop).toBe(true)
    expect(late.events.some((e) => e.type === 'heartbeat_missed')).toBe(true)
  })

  it('sweep stops silent client and bills only through last heartbeat', async () => {
    const ledger = createInMemoryLiveStylePaymentLedger()
    const t0 = 1_000_000
    const { session } = await createLiveStyleSession({
      wallet: '0xabc0000000000000000000000000000000000004',
      providerId: 'mock',
      capPresetUsd: 3,
      isPremium: false,
      nowMs: t0,
    })
    await ledger.recordAuthorization({
      sessionId: session.sessionId,
      wallet: session.wallet,
      capUsdc6: 3_000_000,
      method: 'erc20-approve',
      proof: '0xmock',
      createdAtMs: t0,
    })

    const lastHb = t0 + 20_000
    let active = markMeterStarted(session, t0)
    active = await heartbeatLiveStyleSession(active, ledger, lastHb).then((r) => r.session)
    expect(active.metering.lastHeartbeatAtMs).toBe(lastHb)

    const sweepAt = lastHb + LIVE_STYLE_HEARTBEAT_MISS_MS + 10_000
    const { stoppedSessions } = await sweepStaleLiveStyleSessions([active], ledger, sweepAt)
    expect(stoppedSessions).toHaveLength(1)
    expect(stoppedSessions[0]?.metering.stopReason).toBe('heartbeat_missed')
    expect(stoppedSessions[0]?.metering.billedSeconds).toBe(20)
  })

  it('normal heartbeat cadence does not trigger missed stop', async () => {
    const ledger = createInMemoryLiveStylePaymentLedger()
    const t0 = 0
    const { session } = await createLiveStyleSession({
      wallet: '0xabc0000000000000000000000000000000000005',
      providerId: 'mock',
      capPresetUsd: 3,
      isPremium: false,
      nowMs: t0,
    })
    await ledger.recordAuthorization({
      sessionId: session.sessionId,
      wallet: session.wallet,
      capUsdc6: 3_000_000,
      method: 'erc20-approve',
      proof: '0xmock',
      createdAtMs: t0,
    })

    let current = markMeterStarted(session, t0)
    for (let i = 1; i <= 3; i++) {
      const hb = await heartbeatLiveStyleSession(current, ledger, t0 + i * 10_000)
      expect(hb.shouldStop).toBe(false)
      current = hb.session
    }
    const { stoppedSessions } = await sweepStaleLiveStyleSessions(
      [current],
      ledger,
      t0 + 25_000,
    )
    expect(stoppedSessions).toHaveLength(0)
  })

  it('stopForMissedHeartbeat settles without advancing billable seconds to sweep time', async () => {
    const ledger = createInMemoryLiveStylePaymentLedger()
    const t0 = 0
    const { session } = await createLiveStyleSession({
      wallet: '0xabc0000000000000000000000000000000000006',
      providerId: 'mock',
      capPresetUsd: 3,
      isPremium: false,
      nowMs: t0,
    })
    await ledger.recordAuthorization({
      sessionId: session.sessionId,
      wallet: session.wallet,
      capUsdc6: 3_000_000,
      method: 'erc20-approve',
      proof: '0xmock',
      createdAtMs: t0,
    })

    const lastHb = t0 + 15_000
    let active = markMeterStarted(session, t0)
    active = (await heartbeatLiveStyleSession(active, ledger, lastHb)).session
    const sweepAt = lastHb + 120_000
    const result = await stopForMissedHeartbeat(active, ledger, sweepAt)
    expect(result.session.metering.billedSeconds).toBe(15)
  })
})
