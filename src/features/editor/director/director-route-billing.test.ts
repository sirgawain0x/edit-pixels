import { describe, expect, it, vi, beforeEach } from 'vitest'

const PREMIUM_SIGNER = '0xlinkedsigner00000000000000000000000001'
const SMART_PAYER = '0xsmartaccount00000000000000000000000001'

const resolvePixelsIdentity = vi.fn()
const mockGetDirectorAdkBaseUrl = vi.fn<() => string | null>(() => null)
const mockRunAdkDirector = vi.fn()

vi.mock('../../../../api/_pixels-identity.js', () => ({
  resolvePixelsIdentity: (...args: unknown[]) => resolvePixelsIdentity(...args),
}))

vi.mock('../../../../api/_director-auth.js', () => ({
  isDirectorSecretAuthorized: () => false,
}))

vi.mock('../../../../api/director-billing.js', () => ({
  isDirectorBillingEnforced: () => true,
  quoteDirectorForWallet: vi.fn(),
  resolveDirectorSettlementMinWei: vi.fn(async () => 1_000_000_000_000_000_000n),
  verifyAndConsumeDirectorPayment: vi.fn(async () => ({
    ok: true,
    amountWei: 1_000_000_000_000_000_000n,
    logIndex: 0,
  })),
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

vi.mock('../../../../api/_director-adk.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/_director-adk.js')>(
    '../../../../api/_director-adk.js',
  )
  return {
    ...actual,
    getDirectorAdkBaseUrl: () => mockGetDirectorAdkBaseUrl(),
    getDirectorAdkAppName: () => 'test',
    runAdkDirector: (...args: unknown[]) => mockRunAdkDirector(...args),
  }
})

vi.mock('../../../../api/_director-firestore.js', () => ({
  finalizeDirectorSession: vi.fn(async () => undefined),
  persistDirectorPaymentWhenQuoted: vi.fn(async () => undefined),
  upsertDirectorSession: vi.fn(async () => undefined),
}))

function paidBody() {
  return {
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
    quoteTier: 'premium' as const,
  }
}

function makePaidRequest() {
  const body = paidBody()
  return new Request('http://localhost/api/director', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer privy-jwt',
    },
    body: JSON.stringify(body),
  })
}

function mockVerifiedIdentity() {
  resolvePixelsIdentity.mockResolvedValue({
    ok: true,
    identity: { signer: PREMIUM_SIGNER as `0x${string}`, source: 'privy' },
    body: paidBody(),
  })
}

describe('POST /api/director billing', () => {
  beforeEach(async () => {
    resolvePixelsIdentity.mockReset()
    mockGetDirectorAdkBaseUrl.mockReset()
    mockGetDirectorAdkBaseUrl.mockReturnValue(null)
    mockRunAdkDirector.mockReset()

    const { quoteDirectorForWallet, releaseDirectorPayment, verifyAndConsumeDirectorPayment } =
      await import('../../../../api/director-billing.js')
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
    vi.mocked(releaseDirectorPayment).mockClear()
    vi.mocked(verifyAndConsumeDirectorPayment).mockResolvedValue({
      ok: true,
      amountWei: 1_000_000_000_000_000_000n,
      logIndex: 0,
    })

    const { persistDirectorPaymentWhenQuoted } =
      await import('../../../../api/_director-firestore.js')
    vi.mocked(persistDirectorPaymentWhenQuoted).mockClear()
  })

  it('returns 401 when Privy token is missing', async () => {
    resolvePixelsIdentity.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'missing authorization' }, { status: 401 }),
    })
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
    resolvePixelsIdentity.mockResolvedValue({
      ok: true,
      identity: { signer: PREMIUM_SIGNER as `0x${string}`, source: 'privy' },
      body: {
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
      },
    })

    const { quoteDirectorForWallet, verifyAndConsumeDirectorPayment } =
      await import('../../../../api/director-billing.js')

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

  it('releases payment and returns 502 when ADK /run returns only an error event', async () => {
    mockGetDirectorAdkBaseUrl.mockReturnValue('https://creative-director.example.run.app')
    mockVerifiedIdentity()
    const vertexError =
      "Permission 'aiplatform.endpoints.predict' denied on resource '//aiplatform.googleapis.com/projects/creative-ai-491118/locations/global/publishers/google/models/gemini-3.5-flash'"
    mockRunAdkDirector.mockResolvedValue([{ errorMessage: vertexError }])

    const { releaseDirectorPayment } = await import('../../../../api/director-billing.js')
    const { persistDirectorPaymentWhenQuoted } =
      await import('../../../../api/_director-firestore.js')
    const { POST } = await import('../../../../api/director.js')

    const response = await POST(makePaidRequest())
    const body = (await response.json()) as { error?: string; paymentReleased?: boolean }

    expect(response.status).toBe(502)
    expect(body).toEqual({ error: vertexError, paymentReleased: true })
    expect(releaseDirectorPayment).toHaveBeenCalledWith('0xabc', 0)
    expect(persistDirectorPaymentWhenQuoted).not.toHaveBeenCalled()
  })

  it('releases payment and returns 502 with paymentReleased when ADK /run throws DirectorAdkError', async () => {
    mockGetDirectorAdkBaseUrl.mockReturnValue('https://creative-director.example.run.app')
    mockVerifiedIdentity()
    const { DirectorAdkError } = await import('../../../../api/_director-adk.js')
    mockRunAdkDirector.mockRejectedValue(new DirectorAdkError('run', 503, 'unavailable'))

    const { releaseDirectorPayment } = await import('../../../../api/director-billing.js')
    const { persistDirectorPaymentWhenQuoted } =
      await import('../../../../api/_director-firestore.js')
    const { POST } = await import('../../../../api/director.js')

    const response = await POST(makePaidRequest())
    const body = (await response.json()) as {
      error?: string
      status?: number
      paymentReleased?: boolean
    }

    expect(response.status).toBe(502)
    expect(body).toEqual({
      error: 'Creative Director engine request failed',
      status: 503,
      paymentReleased: true,
    })
    expect(releaseDirectorPayment).toHaveBeenCalledWith('0xabc', 0)
    expect(persistDirectorPaymentWhenQuoted).not.toHaveBeenCalled()
  })

  it('streams SSE and keeps payment consumed when ADK /run produces assistant text', async () => {
    mockGetDirectorAdkBaseUrl.mockReturnValue('https://creative-director.example.run.app')
    mockVerifiedIdentity()
    mockRunAdkDirector.mockResolvedValue([
      { content: { parts: [{ text: 'Shot 1: Neon wide angle' }] } },
    ])

    const { releaseDirectorPayment } = await import('../../../../api/director-billing.js')
    const { persistDirectorPaymentWhenQuoted } =
      await import('../../../../api/_director-firestore.js')
    const { POST } = await import('../../../../api/director.js')

    const response = await POST(makePaidRequest())
    const sseText = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(sseText).toContain('Shot 1: Neon wide angle')
    expect(releaseDirectorPayment).not.toHaveBeenCalled()
    expect(persistDirectorPaymentWhenQuoted).toHaveBeenCalledOnce()
  })
})
