import { describe, expect, it } from 'vitest'
import {
  SETTLEMENT_CREDIT_PACKS,
  SETTLEMENT_USDC6_PER_CREDIT,
  usdcDisplayFromCredits,
} from '@/config/credit-pack-settlement'

describe('usdcDisplayFromCredits', () => {
  it('converts whole credits at $0.10 each', () => {
    expect(usdcDisplayFromCredits(1)).toBe('0.10')
    expect(usdcDisplayFromCredits(75)).toBe('7.50')
    expect(usdcDisplayFromCredits(200)).toBe('20.00')
  })

  it('floors fractional credit counts', () => {
    expect(usdcDisplayFromCredits(10.4)).toBe('1.00')
    expect(usdcDisplayFromCredits(10.9)).toBe('1.00')
  })

  it('returns empty for non-positive or non-finite amounts', () => {
    expect(usdcDisplayFromCredits(0)).toBe('')
    expect(usdcDisplayFromCredits(0.5)).toBe('')
    expect(usdcDisplayFromCredits(-5)).toBe('')
    expect(usdcDisplayFromCredits(Number.NaN)).toBe('')
  })

  it('matches retail pack rate', () => {
    for (const pack of SETTLEMENT_CREDIT_PACKS) {
      expect(pack.usdc6 / pack.credits).toBe(SETTLEMENT_USDC6_PER_CREDIT)
      expect(usdcDisplayFromCredits(pack.credits)).toBe((pack.usdc6 / 1_000_000).toFixed(2))
    }
  })
})
