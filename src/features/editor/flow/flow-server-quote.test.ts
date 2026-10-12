import { describe, expect, it, vi } from 'vitest'
import { fetchFlowServerQuote } from './fetch-flow-server-quote'

describe('fetchFlowServerQuote', () => {
  it('maps a nonzero server Flow quote for checkout', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          quoteId: 'q-flow',
          signature: 'sig',
          expiresAtMs: Date.now() + 60_000,
          slippageBps: 250,
          duration: 8,
          quality: '720p',
          tier: 'standard',
          stillCount: 0,
          videoCredits: 32,
          stillCredits: 0,
          totalCredits: 32,
          estimatedUsdc6: 3_200_000,
          formattedUsd: '$3.20',
          crtvaiRequired: '1000000000000000000',
          crtvaiDisplay: 1,
        }),
        { status: 200 },
      ),
    )

    const quote = await fetchFlowServerQuote(
      {
        token: 'test-token',
        signerAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      {
        duration: 8,
        quality: '720p',
        tier: 'standard',
        stillCount: 0,
      },
    )

    expect(quote).not.toBeNull()
    expect(quote?.crtvaiWei).toBe(1_000_000_000_000_000_000n)
    expect(quote?.quoteId).toBe('q-flow')

    fetchMock.mockRestore()
  })
})
