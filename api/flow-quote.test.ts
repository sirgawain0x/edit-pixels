import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./flow-billing.js', () => ({
  quoteFlowCreditsUsdc6: vi.fn(),
}))

vi.mock('./_wallet-auth.js', () => ({
  getBearerToken: () => 'test-token',
  verifyPrivyAccessToken: async () => ({ address: '0xabc' as `0x${string}` }),
}))

describe('POST /api/flow-quote', () => {
  beforeEach(async () => {
    const { quoteFlowCreditsUsdc6 } = await import('./flow-billing.js')
    vi.mocked(quoteFlowCreditsUsdc6).mockReset()
  })

  it('returns nonzero CRTVAI wei for a priced Flow run', async () => {
    const { quoteFlowCreditsUsdc6 } = await import('./flow-billing.js')
    vi.mocked(quoteFlowCreditsUsdc6).mockResolvedValue({
      quoteId: 'flow-q-1',
      signature: 'signed',
      expiresAtMs: Date.now() + 75_000,
      slippageBps: 250,
      estimatedUsdc6: 3_200_000,
      minCrtvaiWei: 950_000_000_000_000_000n,
    })

    const { POST } = await import('./flow-quote.js')
    const response = await POST(
      new Request('http://localhost/api/flow-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        headers: { Authorization: 'Bearer test-token' },
        body: JSON.stringify({
          duration: 8,
          quality: '720p',
          tier: 'standard',
          stillCount: 0,
        }),
      }),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      crtvaiRequired: string
      crtvaiDisplay: number
      quoteId: string
    }
    expect(body.quoteId).toBe('flow-q-1')
    expect(BigInt(body.crtvaiRequired)).toBeGreaterThan(0n)
    expect(body.crtvaiDisplay).toBeGreaterThan(0)
  })
})
