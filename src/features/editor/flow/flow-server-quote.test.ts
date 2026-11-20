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

  it('passes tier: omni and duration: 10 through server quote round-trip', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          quoteId: 'q-omni',
          signature: 'sig-omni',
          expiresAtMs: Date.now() + 60_000,
          slippageBps: 250,
          duration: 10,
          quality: '720p',
          tier: 'omni',
          stillCount: 0,
          videoCredits: 7,
          stillCredits: 0,
          totalCredits: 7,
          estimatedUsdc6: 700_000,
          formattedUsd: '$0.70',
          crtvaiRequired: '250000000000000000',
          crtvaiDisplay: 0.25,
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
        duration: 10,
        quality: '720p',
        tier: 'omni',
        stillCount: 0,
      },
    )

    expect(quote?.duration).toBe(10)
    expect(quote?.videoCredits).toBe(7)
    expect(quote?.formattedUsd).toBe('$0.70')
    expect(fetchMock).toHaveBeenCalledOnce()
    const requestInit = fetchMock.mock.calls[0]?.[1]
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      tier: 'omni',
      duration: 10,
      quality: '720p',
    })

    fetchMock.mockRestore()
  })
})
