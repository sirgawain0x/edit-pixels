import { describe, expect, it, vi, afterEach } from 'vitest'

describe('validateSettlementAgainstQuote payment minimum', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('returns the quoted wei for treasury verify when curve ticks up inside the band', async () => {
    const quotedWei = 1000n
    const freshWei = 1025n
    vi.doMock('../../../../api/_metoken-curve-math.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../../api/_metoken-curve-math.js')>()
      return {
        ...actual,
        isWithinSlippageBand: () => true,
      }
    })
    vi.doMock('viem', () => ({
      createPublicClient: () => ({
        readContract: async () => freshWei,
      }),
      http: () => ({}),
      parseAbi: () => [],
    }))

    const { validateSettlementAgainstQuote } = await import(
      '../../../../api/_metoken-curve-quote.js'
    )
    const result = await validateSettlementAgainstQuote({
      estimatedUsdc6: 1_000_000,
      minCrtvaiWei: quotedWei,
      expiresAtMs: Date.now() + 60_000,
      slippageBps: 250,
    })
    expect(result.minAmountWei).toBe(quotedWei)
  })
})
