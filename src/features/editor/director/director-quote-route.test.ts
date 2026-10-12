import { describe, expect, it, vi, beforeEach } from 'vitest'

const verifyPrivyAccessToken = vi.fn<
  (token: string, expectedAddress?: string) => Promise<{ address: `0x${string}` } | null>
>()

vi.mock('../../../../api/director-billing.js', () => ({
  quoteDirectorForWallet: vi.fn(),
}))

vi.mock('../../../../api/_wallet-auth.js', () => ({
  getBearerToken: (request: Request) => {
    const header = request.headers.get('authorization')
    if (!header?.startsWith('Bearer ')) return null
    return header.slice('Bearer '.length)
  },
  verifyPrivyAccessToken: (token: string, expectedAddress?: string) =>
    verifyPrivyAccessToken(token, expectedAddress),
}))

describe('POST /api/director-quote', () => {
  beforeEach(async () => {
    verifyPrivyAccessToken.mockReset()
    const { quoteDirectorForWallet } = await import('../../../../api/director-billing.js')
    vi.mocked(quoteDirectorForWallet).mockReset()
  })

  it('returns 401 when authorization is missing', async () => {
    const { POST } = await import('../../../../api/director-quote.js')
    const response = await POST(
      new Request('http://localhost/api/director-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioDurationSeconds: 60 }),
      }),
    )
    expect(response.status).toBe(401)
    expect(verifyPrivyAccessToken).not.toHaveBeenCalled()
  })

  it('returns 401 when Privy verification fails', async () => {
    verifyPrivyAccessToken.mockResolvedValue(null)

    const { POST } = await import('../../../../api/director-quote.js')
    const response = await POST(
      new Request('http://localhost/api/director-quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer bad-token',
        },
        body: JSON.stringify({ audioDurationSeconds: 60 }),
      }),
    )
    expect(response.status).toBe(401)
  })

  it('quotes using the verified Privy wallet, not a spoofed smart-account body address', async () => {
    verifyPrivyAccessToken.mockImplementation(async (_token, expectedAddress) => {
      if (expectedAddress?.toLowerCase() === '0xsmartaccount00000000000000000000000001') {
        return null
      }
      return { address: '0xlinkedsigner00000000000000000000000001' as `0x${string}` }
    })

    const { quoteDirectorForWallet } = await import('../../../../api/director-billing.js')
    vi.mocked(quoteDirectorForWallet).mockResolvedValue({
      quoteId: 'dir-q-1',
      signature: 'signed',
      expiresAtMs: Date.now() + 75_000,
      slippageBps: 250,
      billableMinutes: 1,
      estimatedUsdc6: 50_000,
      minCrtvaiWei: 950_000_000_000_000_000n,
      tier: 'retail',
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

    expect(response.status).toBe(401)
    expect(quoteDirectorForWallet).not.toHaveBeenCalled()

    verifyPrivyAccessToken.mockImplementation(async () => ({
      address: '0xlinkedsigner00000000000000000000000001' as `0x${string}`,
    }))

    const ok = await POST(
      new Request('http://localhost/api/director-quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer good-token',
        },
        body: JSON.stringify({
          audioDurationSeconds: 60,
          walletAddress: '0xLinkedSigner00000000000000000000000001',
        }),
      }),
    )
    expect(ok.status).toBe(200)
    expect(quoteDirectorForWallet).toHaveBeenCalledWith(
      60,
      '0xlinkedsigner00000000000000000000000001',
    )
  })
})
