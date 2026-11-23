/**
 * The payment ledger is where "one transfer = one purchase" is enforced, so these tests pin the
 * two behaviours the export permit depends on: a spent log cannot buy a second thing, and the
 * same buyer re-claiming the same purchase still gets it back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, unknown>()

vi.mock('./_redis-client.js', () => ({
  isRedisConfigured: () => true,
  getRedis: async () => ({
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string, options?: { nx?: boolean }) => {
      if (options?.nx && store.has(key)) return null
      store.set(key, value)
      return 'OK'
    },
    del: async (key: string) => {
      store.delete(key)
    },
  }),
}))

import {
  claimPaymentTxLogForPurpose,
  consumePaymentTxLog,
  readPaymentTxLog,
} from './_payment-ledger.js'

const TX = `0x${'a'.repeat(64)}`
const WALLET = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'
const OTHER_WALLET = '0xbbbb0000000000000000000000000000000000b2'

beforeEach(() => {
  store.clear()
})

describe('claimPaymentTxLogForPurpose', () => {
  it('spends a log on the first claim', async () => {
    await expect(
      claimPaymentTxLogForPurpose(TX, 7, { wallet: WALLET, purpose: 'export_unlock:p1' }),
    ).resolves.toEqual({ ok: true })
  })

  it('re-issues the same purchase to the same payer, so a lost permit is not a second charge', async () => {
    const claim = { wallet: WALLET, purpose: 'export_unlock:p1' }

    expect(await claimPaymentTxLogForPurpose(TX, 7, claim)).toEqual({ ok: true })
    // A new browser, a cleared cache: the client presents the same transfer again.
    expect(await claimPaymentTxLogForPurpose(TX, 7, claim)).toEqual({ ok: true })
  })

  it('refuses to spend one transfer on a second project', async () => {
    await claimPaymentTxLogForPurpose(TX, 7, { wallet: WALLET, purpose: 'export_unlock:p1' })

    expect(
      await claimPaymentTxLogForPurpose(TX, 7, { wallet: WALLET, purpose: 'export_unlock:p2' }),
    ).toEqual({ ok: false, reason: 'Payment transaction already used' })
  })

  it('refuses to hand a paid log to a different wallet', async () => {
    await claimPaymentTxLogForPurpose(TX, 7, { wallet: WALLET, purpose: 'export_unlock:p1' })

    expect(
      await claimPaymentTxLogForPurpose(TX, 7, {
        wallet: OTHER_WALLET,
        purpose: 'export_unlock:p1',
      }),
    ).toEqual({ ok: false, reason: 'Payment transaction already used' })
  })

  it('is per log, so a transfer with two matching transfers can fund two purchases', async () => {
    expect(
      await claimPaymentTxLogForPurpose(TX, 7, { wallet: WALLET, purpose: 'export_unlock:p1' }),
    ).toEqual({ ok: true })
    expect(
      await claimPaymentTxLogForPurpose(TX, 8, { wallet: WALLET, purpose: 'export_unlock:p2' }),
    ).toEqual({ ok: true })
  })
})

describe('readPaymentTxLog', () => {
  it('reports what a log was spent on', async () => {
    await consumePaymentTxLog(TX, 7, { wallet: WALLET, purpose: 'export_unlock:p1' })

    expect(await readPaymentTxLog(TX, 7)).toMatchObject({
      wallet: WALLET,
      purpose: 'export_unlock:p1',
      logIndex: 7,
    })
  })

  it('reads a record the Upstash client has already deserialised', async () => {
    // `Redis.get` returns parsed JSON for values written with `JSON.stringify`; a string-only
    // guard read every spent log as unspent, which rejected legitimate re-issues.
    store.set(`pixels:payment:tx:${TX}:7`, {
      wallet: WALLET,
      purpose: 'export_unlock:p1',
      logIndex: 7,
      at: Date.now(),
    })

    expect(await readPaymentTxLog(TX, 7)).toMatchObject({
      wallet: WALLET,
      purpose: 'export_unlock:p1',
    })
  })

  it('re-issues to the same payer when the stored record came back as an object', async () => {
    store.set(`pixels:payment:tx:${TX}:7`, {
      wallet: WALLET,
      purpose: 'export_unlock:p1',
      logIndex: 7,
    })

    await expect(
      claimPaymentTxLogForPurpose(TX, 7, { wallet: WALLET, purpose: 'export_unlock:p1' }),
    ).resolves.toEqual({ ok: true })
    // Still refuses to widen it to another project.
    await expect(
      claimPaymentTxLogForPurpose(TX, 7, { wallet: WALLET, purpose: 'export_unlock:p2' }),
    ).resolves.toEqual({ ok: false, reason: 'Payment transaction already used' })
  })

  it('returns null for an unspent log or a malformed hash', async () => {
    expect(await readPaymentTxLog(TX, 3)).toBeNull()
    expect(await readPaymentTxLog('0xdead', 3)).toBeNull()
  })
})
