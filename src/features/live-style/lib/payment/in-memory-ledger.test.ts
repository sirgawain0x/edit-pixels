// @vitest-environment node
import { describe, expect, it } from 'vite-plus/test'
import { createInMemoryLiveStylePaymentLedger } from './in-memory-ledger'

describe('in-memory live style payment ledger', () => {
  it('true-up on next pull after overpull', async () => {
    const ledger = createInMemoryLiveStylePaymentLedger()
    await ledger.recordAuthorization({
      sessionId: 's1',
      wallet: '0x1',
      capUsdc6: 1_000_000,
      method: 'erc20-approve',
      proof: 'p',
      createdAtMs: 0,
    })
    const first = await ledger.pullArrears('s1', 200_000)
    expect(first.ok).toBe(true)
    await ledger.trueUp('s1', -50_000)
    const second = await ledger.pullArrears('s1', 100_000)
    expect(second.ok).toBe(true)
    expect(ledger.getPulled('s1')).toBeLessThanOrEqual(1_000_000)
  })
})
