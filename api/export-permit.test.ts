import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'
const PROJECT = 'project-1'
const SECRET = 'a-test-signing-secret-long-enough'

vi.mock('./_rate-limit.js', () => ({
  checkPixelsRateLimits: vi.fn(async () => null),
}))

vi.mock('./_pixels-generate-route-auth.js', () => ({
  authenticateGenerativePost: vi.fn(),
  verifyGenerativeCrtvaiPayment: vi.fn(),
}))

vi.mock('./_metoken-curve-quote.js', () => ({
  quoteCrtvaiForUsdc6: vi.fn(),
}))

import { checkPixelsRateLimits } from './_rate-limit.js'
import {
  authenticateGenerativePost,
  verifyGenerativeCrtvaiPayment,
} from './_pixels-generate-route-auth.js'
import { quoteCrtvaiForUsdc6 } from './_metoken-curve-quote.js'
import { EXPORT_UNLOCK_USDC6, verifyExportPermit } from './_export-permit.js'
import { POST } from './export-permit.js'

function post(body: Record<string, unknown>): Request {
  return new Request('https://pixels.test/api/export-permit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
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
    expiresAtMs: Date.now() + 60_000,
  } as Awaited<ReturnType<typeof quoteCrtvaiForUsdc6>>)

  vi.mocked(verifyGenerativeCrtvaiPayment).mockReset()
  vi.mocked(verifyGenerativeCrtvaiPayment).mockResolvedValue({ ok: true, logIndex: 7 })
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
      minCrtvaiWei: '5000000000000000000',
    })
    // A quote must never mint a permit — only a verified payment does.
    expect(body).not.toHaveProperty('permit')
    expect(vi.mocked(verifyGenerativeCrtvaiPayment)).not.toHaveBeenCalled()
  })

  it('verifies the transfer against the pinned minimum and the project it is for', async () => {
    await POST(post({ projectId: PROJECT, paymentTxHash: '0xfeed' }))

    expect(vi.mocked(verifyGenerativeCrtvaiPayment).mock.calls[0]?.[0]).toMatchObject({
      paymentTxHash: '0xfeed',
      signer: ACCOUNT,
      payer: ACCOUNT,
      purpose: `export_unlock:${PROJECT}`,
    })
  })

  it('refuses to mint a permit when the payment does not verify', async () => {
    vi.mocked(verifyGenerativeCrtvaiPayment).mockResolvedValue({
      ok: false,
      reason: 'insufficient_amount',
    })

    const response = await POST(post({ projectId: PROJECT, paymentTxHash: '0xfeed' }))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(402)
    expect(body).toMatchObject({ error: 'payment_not_verified', reason: 'insufficient_amount' })
    expect(body).not.toHaveProperty('permit')
  })

  it('mints a permit the client can present, scoped to this account and project', async () => {
    const response = await POST(post({ projectId: PROJECT, paymentTxHash: '0xfeed' }))
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

  it('returns 503 rather than an unsigned permit when signing is not configured', async () => {
    delete process.env.PIXELS_QUOTE_SIGNING_SECRET

    const response = await POST(post({ projectId: PROJECT, paymentTxHash: '0xfeed' }))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'permit_unavailable' })
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
