import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('verifyAndConsumeLiveStyleSpendAuth production policy', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('proceeds to on-chain verification in production when config is valid', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('LIVE_STYLE_ENABLED', '1')
    vi.stubEnv('LIVE_STYLE_PAYMENT_SPENDER', '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')

    const verifyLiveStyleSpendAuth = vi.fn().mockResolvedValue({ ok: true })
    vi.doMock('../../../../api/_payment-ledger.js', () => ({
      isPaymentLedgerReady: () => true,
      consumePaymentTxHash: vi.fn().mockResolvedValue({ ok: true }),
    }))
    vi.doMock('./spend-auth-verify.ts', () => ({
      verifyLiveStyleSpendAuth,
      spendAuthProofTxHash: (proof: string) => proof,
      PERMIT2_ADDRESS: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    }))

    const { verifyAndConsumeLiveStyleSpendAuth, isLiveStyleSpendAuthEnforced } =
      await import('../../../../api/_live-style-spend-auth-verify.js')

    expect(isLiveStyleSpendAuthEnforced()).toBe(true)

    const result = await verifyAndConsumeLiveStyleSpendAuth({
      proof: `0x${'aa'.repeat(32)}`,
      method: 'erc20-approve',
      wallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      capUsdc6: 1_000_000,
      nowMs: Date.now(),
    })

    expect(result.ok).toBe(true)
    expect(verifyLiveStyleSpendAuth).toHaveBeenCalled()
  })
})
