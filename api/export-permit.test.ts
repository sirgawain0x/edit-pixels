import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'
const PROJECT = 'project-1'
const SECRET = 'a-test-signing-secret-long-enough'

const QUOTE = {
  quoteId: 'quote-1',
  signature: 'signed-quote',
  minCrtvaiWei: '5000000000000000000',
  expiresAtMs: Date.now() + 60_000,
  slippageBps: 150,
}

vi.mock('./_rate-limit.js', () => ({
  checkPixelsRateLimits: vi.fn(async () => null),
}))

vi.mock('./_pixels-generate-route-auth.js', () => ({
  authenticateGenerativePost: vi.fn(),
}))

vi.mock('./_pixels-payment-payer.js', () => ({
  assertPaymentPayerMatchesSigner: vi.fn(() => ({ ok: true })),
}))

vi.mock('./_metoken-curve-quote.js', async () => {
  const actual = await vi.importActual<typeof import('./_metoken-curve-quote.js')>(
    './_metoken-curve-quote.js',
  )
  return {
    ...actual,
    quoteCrtvaiForUsdc6: vi.fn(),
    verifyQuoteSignature: vi.fn(() => true),
    validateSettlementAgainstQuote: vi.fn(),
    isQuoteSigningConfigured: vi.fn(() => true),
  }
})

vi.mock('./director-billing.js', () => ({
  verifyDirectorPayment: vi.fn(),
}))

vi.mock('./_payment-ledger.js', () => ({
  claimPaymentTxLogForPurpose: vi.fn(),
}))

import { checkPixelsRateLimits } from './_rate-limit.js'
import { authenticateGenerativePost } from './_pixels-generate-route-auth.js'
import { assertPaymentPayerMatchesSigner } from './_pixels-payment-payer.js'
import {
  quoteCrtvaiForUsdc6,
  isQuoteSigningConfigured,
  validateSettlementAgainstQuote,
  verifyQuoteSignature,
  MetokenQuoteError,
} from './_metoken-curve-quote.js'
import { verifyDirectorPayment } from './director-billing.js'
import { claimPaymentTxLogForPurpose } from './_payment-ledger.js'
import { EXPORT_UNLOCK_USDC6, verifyExportPermit } from './_export-permit.js'
import { POST } from './export-permit.js'

function post(body: Record<string, unknown>): Request {
  return new Request('https://pixels.test/api/export-permit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** A redemption request, with the quote proof redemption requires. */
function redeem(overrides: Record<string, unknown> = {}): Request {
  return post({ projectId: PROJECT, paymentTxHash: '0xfeed', quote: QUOTE, ...overrides })
}

beforeEach(() => {
  process.env.PIXELS_QUOTE_SIGNING_SECRET = SECRET

  vi.mocked(authenticateGenerativePost).mockReset()
  vi.mocked(authenticateGenerativePost).mockImplementation(async (request: Request) => ({
    ok: true,
    signer: ACCOUNT,
    payer: ACCOUNT,
    body: (await request.clone().json()) as Record<string, unknown>,
  }))

  vi.mocked(checkPixelsRateLimits).mockReset()
  vi.mocked(checkPixelsRateLimits).mockResolvedValue(null)

  vi.mocked(quoteCrtvaiForUsdc6).mockReset()
  vi.mocked(quoteCrtvaiForUsdc6).mockResolvedValue({
    minCrtvaiWei: 5_000_000_000_000_000_000n,
    estimatedUsdc6: EXPORT_UNLOCK_USDC6,
    quoteId: QUOTE.quoteId,
    signature: QUOTE.signature,
    expiresAtMs: QUOTE.expiresAtMs,
    slippageBps: QUOTE.slippageBps,
    curve: { supplyWei: 1n, balancePooledUsdc6: 0n },
  } as Awaited<ReturnType<typeof quoteCrtvaiForUsdc6>>)

  vi.mocked(assertPaymentPayerMatchesSigner).mockReset()
  vi.mocked(assertPaymentPayerMatchesSigner).mockReturnValue({ ok: true })

  vi.mocked(isQuoteSigningConfigured).mockReset()
  vi.mocked(isQuoteSigningConfigured).mockReturnValue(true)

  vi.mocked(verifyQuoteSignature).mockReset()
  vi.mocked(verifyQuoteSignature).mockReturnValue(true)

  vi.mocked(validateSettlementAgainstQuote).mockReset()
  vi.mocked(validateSettlementAgainstQuote).mockResolvedValue({
    minAmountWei: BigInt(QUOTE.minCrtvaiWei),
  })

  vi.mocked(verifyDirectorPayment).mockReset()
  vi.mocked(verifyDirectorPayment).mockResolvedValue({
    ok: true,
    amountWei: BigInt(QUOTE.minCrtvaiWei),
    logIndex: 7,
    // Mined while the quote was still live — the case a retry must not punish.
    blockTimestampMs: QUOTE.expiresAtMs - 1_000,
  })

  vi.mocked(claimPaymentTxLogForPurpose).mockReset()
  vi.mocked(claimPaymentTxLogForPurpose).mockResolvedValue({ ok: true })
})

afterEach(() => {
  delete process.env.PIXELS_QUOTE_SIGNING_SECRET
})

describe('POST /api/export-permit', () => {
  it('rejects a body without a project id, or with an absurd one', async () => {
    for (const body of [{}, { projectId: '   ' }, { projectId: 'x'.repeat(200) }]) {
      const response = await POST(post(body))
      expect(response.status).toBe(400)
    }
    expect(vi.mocked(quoteCrtvaiForUsdc6)).not.toHaveBeenCalled()
  })

  it('quotes $5 without asking for a payment first', async () => {
    const response = await POST(post({ projectId: PROJECT }))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      projectId: PROJECT,
      priceUsd: 5,
      estimatedUsdc6: EXPORT_UNLOCK_USDC6,
      minCrtvaiWei: QUOTE.minCrtvaiWei,
    })
    // A quote must never mint a permit — only a verified payment does.
    expect(body).not.toHaveProperty('permit')
    expect(vi.mocked(verifyDirectorPayment)).not.toHaveBeenCalled()
  })

  it('hands the signed quote back so redemption can prove the price', async () => {
    const response = await POST(post({ projectId: PROJECT }))
    const body = (await response.json()) as Record<string, unknown>

    expect(body).toMatchObject({
      quoteId: QUOTE.quoteId,
      signature: QUOTE.signature,
      slippageBps: QUOTE.slippageBps,
      expiresAtMs: QUOTE.expiresAtMs,
    })
  })

  it('verifies against the quoted minimum rather than a freshly derived one', async () => {
    // The curve has moved up since the quote; the buyer sent what it was quoted.
    await POST(redeem())

    expect(vi.mocked(verifyQuoteSignature).mock.calls[0]?.[0]).toMatchObject({
      quoteId: QUOTE.quoteId,
      signature: QUOTE.signature,
      minCrtvaiWei: BigInt(QUOTE.minCrtvaiWei),
      tier: 'export-unlock',
    })
    expect(vi.mocked(verifyDirectorPayment).mock.calls[0]?.[0]).toMatchObject({
      txHash: '0xfeed',
      minAmountWei: BigInt(QUOTE.minCrtvaiWei),
    })
  })

  it('refuses a forged or unsigned quote proof', async () => {
    vi.mocked(verifyQuoteSignature).mockReturnValue(false)

    const response = await POST(redeem())

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'payment_not_verified' })
    expect(vi.mocked(verifyDirectorPayment)).not.toHaveBeenCalled()

    // Without the signing secret the quote is `unsigned:<payload>`, which anyone can mint.
    vi.mocked(isQuoteSigningConfigured).mockReturnValue(false)
    const unsigned = await POST(redeem({ quote: { ...QUOTE, signature: 'unsigned:forged' } }))
    expect(unsigned.status).toBe(400)
  })

  it('refuses a redemption with no quote proof instead of re-pricing', async () => {
    const response = await POST(post({ projectId: PROJECT, paymentTxHash: '0xfeed' }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'quote_missing' })
    expect(vi.mocked(verifyDirectorPayment)).not.toHaveBeenCalled()
  })

  it('surfaces an expired or slipped quote when the block time is unknown', async () => {
    vi.mocked(verifyDirectorPayment).mockResolvedValue({
      ok: true,
      amountWei: BigInt(QUOTE.minCrtvaiWei),
      logIndex: 7,
    })
    vi.mocked(validateSettlementAgainstQuote).mockRejectedValue(
      new MetokenQuoteError('quote_expired', 'Quote expired — request a new price.'),
    )

    const response = await POST(redeem())

    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({
      error: 'payment_not_verified',
      reason: 'Quote expired — request a new price.',
    })
    expect(vi.mocked(claimPaymentTxLogForPurpose)).not.toHaveBeenCalled()
  })

  it('accepts a retry of a payment that was mined inside the quote window', async () => {
    // The quote expired hours ago; the transfer landed while it was live. Refusing this took
    // the money and issued nothing, for a permit that is valid for a year.
    const expiredQuote = { ...QUOTE, expiresAtMs: Date.now() - 6 * 60 * 60 * 1000 }
    vi.mocked(verifyDirectorPayment).mockResolvedValue({
      ok: true,
      amountWei: BigInt(QUOTE.minCrtvaiWei),
      logIndex: 7,
      blockTimestampMs: expiredQuote.expiresAtMs + 5_000,
    })

    const response = await POST(redeem({ quote: expiredQuote }))

    expect(response.status).toBe(200)
    expect(await response.json()).toHaveProperty('permit')
    // The freshness re-check is for late payments only; this one was on time.
    expect(vi.mocked(validateSettlementAgainstQuote)).not.toHaveBeenCalled()
  })

  it('refuses a payment that was mined after the quote window closed', async () => {
    const expiredQuote = { ...QUOTE, expiresAtMs: Date.now() - 60 * 60 * 1000 }
    vi.mocked(verifyDirectorPayment).mockResolvedValue({
      ok: true,
      amountWei: BigInt(QUOTE.minCrtvaiWei),
      logIndex: 7,
      blockTimestampMs: expiredQuote.expiresAtMs + 60 * 60 * 1000,
    })

    const response = await POST(redeem({ quote: expiredQuote }))

    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({ error: 'payment_not_verified' })
    expect(vi.mocked(claimPaymentTxLogForPurpose)).not.toHaveBeenCalled()
  })

  it('falls back to the quote checks when the block time is unavailable', async () => {
    vi.mocked(verifyDirectorPayment).mockResolvedValue({
      ok: true,
      amountWei: BigInt(QUOTE.minCrtvaiWei),
      logIndex: 7,
    })

    await POST(redeem())

    expect(vi.mocked(validateSettlementAgainstQuote)).toHaveBeenCalledTimes(1)
  })

  it('claims the transfer for longer than the permit it protects', async () => {
    await POST(redeem())

    const [, , meta] = vi.mocked(claimPaymentTxLogForPurpose).mock.calls[0] ?? []
    // The permit lasts a year; a 14-day claim would let the same transfer unlock a second
    // project a fortnight later.
    expect(meta?.ttlSeconds).toBeGreaterThan(365 * 24 * 60 * 60)
  })

  it('rejects a payment whose payer is not linked to the authenticated wallet', async () => {
    vi.mocked(assertPaymentPayerMatchesSigner).mockReturnValue({
      ok: false,
      reason: 'Payment payer is not linked to the authenticated wallet',
    })

    const response = await POST(redeem())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'payment_not_verified' })
    expect(vi.mocked(claimPaymentTxLogForPurpose)).not.toHaveBeenCalled()
  })

  it('refuses to mint a permit when the payment does not verify', async () => {
    vi.mocked(verifyDirectorPayment).mockResolvedValue({
      ok: false,
      reason: 'insufficient_amount',
    })

    const response = await POST(redeem())
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(402)
    expect(body).toMatchObject({ error: 'payment_not_verified', reason: 'insufficient_amount' })
    expect(body).not.toHaveProperty('permit')
  })

  it('mints a permit the client can present, scoped to this account and project', async () => {
    const response = await POST(redeem())
    const body = (await response.json()) as { permit: string; expiresAtMs: number }

    expect(response.status).toBe(200)
    expect(body.permit).toBeTruthy()
    expect(
      verifyExportPermit(body.permit, { accountId: ACCOUNT, projectId: PROJECT }),
    ).toMatchObject({ ok: true, payload: { txHash: '0xfeed' } })
    // The same token is worthless on another project.
    expect(
      verifyExportPermit(body.permit, { accountId: ACCOUNT, projectId: 'project-2' }),
    ).toMatchObject({ ok: false, reason: 'wrong_project' })
  })

  it('spends the transfer once, so one payment cannot unlock a second project', async () => {
    await POST(redeem())

    expect(vi.mocked(claimPaymentTxLogForPurpose).mock.calls[0]).toEqual([
      '0xfeed',
      7,
      expect.objectContaining({ wallet: ACCOUNT, purpose: `export_unlock:${PROJECT}` }),
    ])

    // The ledger refuses the second claim: same dollars, different project.
    vi.mocked(claimPaymentTxLogForPurpose).mockResolvedValue({
      ok: false,
      reason: 'Payment transaction already used',
    })

    const response = await POST(redeem({ projectId: 'project-2' }))
    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({
      error: 'payment_not_verified',
      reason: 'Payment transaction already used',
    })
  })

  it('verifies without consuming, so the claim is the only thing that spends the payment', async () => {
    await POST(redeem())

    // `verifyDirectorPayment` is the non-consuming verifier; the consuming one already burned
    // the transfer and made a lost permit unrecoverable.
    expect(vi.mocked(verifyDirectorPayment)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(claimPaymentTxLogForPurpose)).toHaveBeenCalledTimes(1)
  })

  it('leaves the payment unspent when signing is not configured', async () => {
    delete process.env.PIXELS_QUOTE_SIGNING_SECRET

    const response = await POST(redeem())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'permit_unavailable' })
    // Signing happens first on purpose: an unconfigured deploy must not burn the transfer.
    expect(vi.mocked(claimPaymentTxLogForPurpose)).not.toHaveBeenCalled()
  })

  it('surfaces a curve failure as an unavailable quote, not a crash', async () => {
    vi.mocked(quoteCrtvaiForUsdc6).mockRejectedValue(new Error('rpc down'))

    const response = await POST(post({ projectId: PROJECT }))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'quote_unavailable' })
  })

  it('stops when the caller is rate limited', async () => {
    vi.mocked(checkPixelsRateLimits).mockResolvedValue(
      Response.json({ error: 'rate_limited' }, { status: 429 }),
    )

    const response = await POST(post({ projectId: PROJECT }))

    expect(response.status).toBe(429)
    expect(vi.mocked(quoteCrtvaiForUsdc6)).not.toHaveBeenCalled()
  })
})
