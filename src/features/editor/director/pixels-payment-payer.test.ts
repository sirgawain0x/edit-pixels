import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import { predictPixelsSmartAccountForSigner } from '../../../../api/_pixels-smart-account.js'

describe('assertPaymentPayerMatchesSigner', () => {
  const SIGNER = getAddress('0x1111111111111111111111111111111111111111')
  const SMART = predictPixelsSmartAccountForSigner(SIGNER)
  const STRANGER = getAddress('0x3333333333333333333333333333333333333333')

  it('accepts the verified signer paying directly from their EOA', async () => {
    const { assertPaymentPayerMatchesSigner } = await import(
      '../../../../api/_pixels-payment-payer.js'
    )
    const result = assertPaymentPayerMatchesSigner(SIGNER, SIGNER)
    expect(result).toEqual({ ok: true })
  })

  it('accepts the predicted Alchemy smart account for the verified signer', async () => {
    const { assertPaymentPayerMatchesSigner } = await import(
      '../../../../api/_pixels-payment-payer.js'
    )
    const result = assertPaymentPayerMatchesSigner(SMART, SIGNER)
    expect(result).toEqual({ ok: true })
  })

  it('rejects an unlinked payer address', async () => {
    const { assertPaymentPayerMatchesSigner } = await import(
      '../../../../api/_pixels-payment-payer.js'
    )
    const result = assertPaymentPayerMatchesSigner(STRANGER, SIGNER)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/not linked/i)
    }
  })
})
