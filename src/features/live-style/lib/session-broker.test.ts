// @vitest-environment node
import { describe, expect, it } from 'vite-plus/test'
import { createInMemoryLiveStylePaymentLedger } from './payment/in-memory-ledger'
import type { LiveStyleSpendAuthorization } from './payment/types'
import {
  createLiveStyleSession,
  heartbeatLiveStyleSession,
  markMeterStarted,
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
        billedSeconds: 60,
      },
      meterActive: true,
    }
    const hb = await heartbeatLiveStyleSession(current, ledger, t0)
    expect(hb.shouldStop).toBe(true)
    expect(hb.events.some((e) => e.type === 'cap_reached')).toBe(true)
  })
})
