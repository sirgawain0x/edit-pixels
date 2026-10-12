import { describe, expect, it, vi } from 'vitest'
import { fetchDirectorServerQuote } from './fetch-director-server-quote'

const SIGNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`

describe('fetchDirectorServerQuote', () => {
  it('sends Privy bearer token and signer hint (not smart account)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          quoteId: 'q-dir',
          signature: 'sig',
          expiresAtMs: Date.now() + 60_000,
          slippageBps: 250,
          billableMinutes: 1,
          estimatedUsdc6: 50_000,
          formattedUsd: '$0.05',
          crtvaiRequired: '1000000000000000000',
          crtvaiDisplay: 1,
          tier: 'retail',
          audioDurationSeconds: 60,
        }),
        { status: 200 },
      ),
    )

    await fetchDirectorServerQuote(
      { token: 'privy-jwt', signerAddress: SIGNER },
      { audioDurationSeconds: 60 },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/director-quote',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer privy-jwt',
          'x-pixels-signer': SIGNER,
        }),
        body: JSON.stringify({
          token: 'privy-jwt',
          signerAddress: SIGNER,
          audioDurationSeconds: 60,
        }),
      }),
    )

    fetchMock.mockRestore()
  })
})
