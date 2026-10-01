import { describe, expect, it } from 'vitest'
import { needsUsdcMoveToSmartWallet } from '@/features/wallet/lib/send-token-math'

describe('needsUsdcMoveToSmartWallet', () => {
  const base = {
    onBase: true,
    token: 'usdc' as const,
    amountWei: 5_000_000n,
    hasSmartAccount: true,
    signerUsdcBalance: '5',
    usdcBalance: '0',
    gasBufferUsdc6: 0,
    canSendFromSigner: false,
  }

  it('is true when signer has USDC and smart wallet is short', () => {
    expect(needsUsdcMoveToSmartWallet(base)).toBe(true)
  })

  it('is false off Base or for CRTVAI', () => {
    expect(needsUsdcMoveToSmartWallet({ ...base, onBase: false })).toBe(false)
    expect(needsUsdcMoveToSmartWallet({ ...base, token: 'crtvai' })).toBe(false)
  })

  it('is false when send can already use the signer balance', () => {
    expect(needsUsdcMoveToSmartWallet({ ...base, canSendFromSigner: true })).toBe(false)
  })

  it('is false when the smart wallet already covers the required amount', () => {
    expect(needsUsdcMoveToSmartWallet({ ...base, usdcBalance: '5' })).toBe(false)
  })
})
