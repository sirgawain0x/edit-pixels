import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../../../api/_pixels-smart-account.js', () => ({
  resolvePixelsSmartAccountForSigner: vi.fn(),
}))

describe('assertPaymentPayerMatchesSigner', () => {
  const SIGNER = '0x1111111111111111111111111111111111111111'
  const SMART = '0x2222222222222222222222222222222222222222'
  const STRANGER = '0x3333333333333333333333333333333333333333'

  beforeEach(async () => {
    const { resolvePixelsSmartAccountForSigner } = await import(
      '../../../../api/_pixels-smart-account.js'
    )
    vi.mocked(resolvePixelsSmartAccountForSigner).mockReset()
    vi.mocked(resolvePixelsSmartAccountForSigner).mockResolvedValue(SMART as `0x${string}`)
  })

  it('accepts the verified signer paying directly from their EOA', async () => {
    const { assertPaymentPayerMatchesSigner } = await import(
      '../../../../api/_pixels-payment-payer.js'
    )
    const result = await assertPaymentPayerMatchesSigner(SIGNER, SIGNER)
    expect(result).toEqual({ ok: true })
  })

  it('accepts the Alchemy smart account derived for the verified signer', async () => {
    const { assertPaymentPayerMatchesSigner } = await import(
      '../../../../api/_pixels-payment-payer.js'
    )
    const result = await assertPaymentPayerMatchesSigner(SMART, SIGNER)
    expect(result).toEqual({ ok: true })
  })

  it('rejects an unlinked payer address', async () => {
    const { assertPaymentPayerMatchesSigner } = await import(
      '../../../../api/_pixels-payment-payer.js'
    )
    const result = await assertPaymentPayerMatchesSigner(STRANGER, SIGNER)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/not linked/i)
    }
  })
})
