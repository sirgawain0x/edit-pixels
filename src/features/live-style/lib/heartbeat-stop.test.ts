// @vitest-environment node
import { describe, expect, it } from 'vite-plus/test'
import { createInMemoryLiveStylePaymentLedger } from './payment/in-memory-ledger'
import { sessionAfterStoppingHeartbeat } from './heartbeat-stop'
import {
  createLiveStyleSession,
  heartbeatLiveStyleSession,
  markMeterStarted,
  stopForMissedHeartbeat,
} from './session-broker'

describe('sessionAfterStoppingHeartbeat', () => {
  it('returns settled session for cap stop (not pre-settlement metering)', async () => {
    const ledger = createInMemoryLiveStylePaymentLedger()
    const t0 = 0
    const { session } = await createLiveStyleSession({
      wallet: '0xabc0000000000000000000000000000000000001',
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
    })

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

    const settled = await sessionAfterStoppingHeartbeat(hb, ledger)
    expect(settled.metering.pulledUsdc6).toBeGreaterThan(0)
    expect(settled.metering.billedSeconds).toBe(60)
  })

  it('returns missed-heartbeat session with settlement from stopForMissedHeartbeat', async () => {
    const ledger = createInMemoryLiveStylePaymentLedger()
    const t0 = 1_000_000
    const { session } = await createLiveStyleSession({
      wallet: '0xabc0000000000000000000000000000000000002',
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

    const started = markMeterStarted(session, t0)
    const active = (await heartbeatLiveStyleSession(started, ledger, t0 + 20_000)).session
    const missed = await stopForMissedHeartbeat(active, ledger, t0 + 120_000)
    const settled = await sessionAfterStoppingHeartbeat(missed, ledger)
    expect(settled.metering.stopReason).toBe('heartbeat_missed')
    expect(settled.metering.billedSeconds).toBe(20)
    expect(settled.metering.pulledUsdc6).toBeGreaterThan(0)
  })
})
