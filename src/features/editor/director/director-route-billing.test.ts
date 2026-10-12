import { describe, expect, it, vi, beforeEach } from 'vitest'

const PREMIUM_SIGNER = '0xlinkedsigner00000000000000000000000001'
const SMART_PAYER = '0xsmartaccount00000000000000000000000001'

vi.mock('../../../../api/_wallet-auth.js', () => ({
  getBearerToken: (request: Request) => {
    const header = request.headers.get('authorization')
    if (!header?.startsWith('Bearer ')) return null
    return header.slice('Bearer '.length)
  },
  verifyPrivyAccessToken: async () => ({ address: PREMIUM_SIGNER as `0x${string}` }),
}))

vi.mock('../../../../api/_director-auth.js', () => ({
  isDirectorSecretAuthorized: () => false,
}))

vi.mock('../../../../api/director-billing.js', () => ({
  isDirectorBillingEnforced: () => true,
  quoteDirectorForWallet: vi.fn(),
  resolveDirectorSettlementMinWei: vi.fn(async () => 1_000_000_000_000_000_000n),
  verifyAndConsumeDirectorPayment: vi.fn(async () => ({ ok: true, amountWei: 1_000_000_000_000_000_000n })),
  releaseDirectorPayment: vi.fn(async () => undefined),
}))

vi.mock('../../../../api/_vertex-auth.js', () => ({
  getVertexAccessToken: async () => {
    throw new Error('stop-after-payment')
  },
  getVertexLocation: () => 'us-east1',
  getVertexProject: () => 'test',
  isDirectorUpstreamAuthFailure: () => false,
  vertexAuthFailureMessage: () => 'stop',
}))

vi.mock('../../../../api/_director-adk.js', () => ({
  getDirectorAdkBaseUrl: () => null,
  getDirectorAdkAppName: () => 'test',
}))

describe('POST /api/director billing', () => {
  beforeEach(async () => {
    const { quoteDirectorForWallet } = await import('../../../../api/director-billing.js')
    vi.mocked(quoteDirectorForWallet).mockReset()
    vi.mocked(quoteDirectorForWallet).mockResolvedValue({
      quoteId: 'dir-q-premium',
      signature: 'signed',
      expiresAtMs: Date.now() + 75_000,
      slippageBps: 250,
      billableMinutes: 1,
      estimatedUsdc6: 25_000,
      minCrtvaiWei: 1_000_000_000_000_000_000n,
      tier: 'premium',
    })
  })

  it('returns 401 when Privy token is missing', async () => {
    const { POST } = await import('../../../../api/director.js')
    const response = await POST(
      new Request('http://localhost/api/director', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'hello',
          audioDurationSeconds: 60,
          walletAddress: SMART_PAYER,
        }),
      }),
    )
    expect(response.status).toBe(401)
  })

  it('re-quotes with the verified signer while the smart account is only the payer', async () => {
    const { quoteDirectorForWallet, verifyAndConsumeDirectorPayment } = await import(
      '../../../../api/director-billing.js'
    )

    const { POST } = await import('../../../../api/director.js')
    const response = await POST(
      new Request('http://localhost/api/director', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer privy-jwt',
        },
        body: JSON.stringify({
          prompt: 'hello',
          token: 'privy-jwt',
          audioDurationSeconds: 60,
          paymentTxHash: '0xabc',
          walletAddress: SMART_PAYER,
          quoteId: 'dir-q-premium',
          quoteSignature: 'signed',
          quoteExpiresAtMs: Date.now() + 75_000,
          quoteSlippageBps: 250,
          quoteEstimatedUsdc6: 25_000,
          quoteCrtvaiRequired: '1000000000000000000',
          quoteTier: 'premium',
        }),
      }),
    )

    expect(quoteDirectorForWallet).toHaveBeenCalledWith(60, PREMIUM_SIGNER)
    expect(verifyAndConsumeDirectorPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        from: SMART_PAYER,
        verifiedSignerAddress: PREMIUM_SIGNER,
      }),
    )
    expect(response.status).not.toBe(402)
  })
})
