import { describe, expect, it, vi, beforeEach } from 'vitest'

const resolvePixelsIdentity = vi.fn()

vi.mock('../../../../api/director-billing.js', () => ({
  quoteDirectorForWallet: vi.fn(),
}))

vi.mock('../../../../api/_pixels-identity.js', () => ({
  resolvePixelsIdentity: (...args: unknown[]) => resolvePixelsIdentity(...args),
}))

describe('POST /api/director-quote', () => {
  beforeEach(async () => {
    resolvePixelsIdentity.mockReset()
    const { quoteDirectorForWallet } = await import('../../../../api/director-billing.js')
    vi.mocked(quoteDirectorForWallet).mockReset()
  })

  it('returns 401 when authorization is missing', async () => {
    resolvePixelsIdentity.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'missing authorization' }, { status: 401 }),
    })

    const { POST } = await import('../../../../api/director-quote.js')
    const response = await POST(
      new Request('http://localhost/api/director-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioDurationSeconds: 60 }),
      }),
    )
    expect(response.status).toBe(401)
  })

  it('prices from the verified signer, not a client payer wallet field', async () => {
    const signer = '0xlinkedsigner00000000000000000000000001' as `0x${string}`
    resolvePixelsIdentity.mockResolvedValue({
      ok: true,
      identity: { signer, source: 'privy' },
      body: { audioDurationSeconds: 60 },
    })

    const { quoteDirectorForWallet } = await import('../../../../api/director-billing.js')
    vi.mocked(quoteDirectorForWallet).mockResolvedValue({
      quoteId: 'dir-q-1',
      signature: 'signed',
      expiresAtMs: Date.now() + 75_000,
      slippageBps: 250,
      billableMinutes: 1,
      estimatedUsdc6: 25_000,
      minCrtvaiWei: 950_000_000_000_000_000n,
      tier: 'premium',
    })

    const { POST } = await import('../../../../api/director-quote.js')
    const response = await POST(
      new Request('http://localhost/api/director-quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer good-token',
        },
        body: JSON.stringify({
          audioDurationSeconds: 60,
          walletAddress: '0xSmartAccount00000000000000000000000001',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(quoteDirectorForWallet).toHaveBeenCalledWith(60, signer)
    const body = (await response.json()) as { tier: string }
    expect(body.tier).toBe('premium')
  })
})
