import { describe, expect, it } from 'vitest'
import {
  METOKEN_QUOTE_EXPIRY_SECONDS,
  METOKEN_QUOTE_SLIPPAGE_BPS,
  validateSettlementAgainstQuote,
} from '../../../../api/_metoken-curve-quote.js'
import {
  calculateMeTokensMintedPure,
  isWithinSlippageBand,
  type CurveState,
} from '../../../../api/_metoken-curve-math.js'

const MEMO_SUPPLY_CRTVAI = 3.199997731857693174
const MEMO_BALANCE_POOLED_USDC6 = 5_120_001n

function memoCurveState(): CurveState {
  return {
    supplyWei: BigInt(Math.floor(MEMO_SUPPLY_CRTVAI * 1e18)),
    balancePooledUsdc6: MEMO_BALANCE_POOLED_USDC6,
  }
}

describe('metoken curve math (memo reference)', () => {
  it('$1 mints ~0.29857 CRTVAI at supply 3.2 and pooled $5.12', () => {
    const minted = calculateMeTokensMintedPure(1_000_000n, memoCurveState())
    const whole = Number(minted) / 1e18
    expect(whole).toBeGreaterThan(0.298)
    expect(whole).toBeLessThan(0.299)
  })
})

describe('quote expiry and slippage', () => {
  it('exports default TTL and slippage band', () => {
    expect(METOKEN_QUOTE_EXPIRY_SECONDS).toBe(75)
    expect(METOKEN_QUOTE_SLIPPAGE_BPS).toBe(250)
  })

  it('rejects settlement after expiry', async () => {
    await expect(
      validateSettlementAgainstQuote({
        estimatedUsdc6: 1_000_000,
        minCrtvaiWei: 100n,
        expiresAtMs: Date.now() - 1,
        slippageBps: METOKEN_QUOTE_SLIPPAGE_BPS,
      }),
    ).rejects.toMatchObject({ code: 'quote_expired' })
  })

  it('rejects when fresh amount exceeds the slippage band', () => {
    const quoted = 298_570_000_000_000_000n
    const fresh = quoted + quoted / 5n
    expect(isWithinSlippageBand(quoted, fresh, METOKEN_QUOTE_SLIPPAGE_BPS)).toBe(false)
    expect(isWithinSlippageBand(quoted, quoted, METOKEN_QUOTE_SLIPPAGE_BPS)).toBe(true)
  })
})
