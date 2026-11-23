import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  EXPORT_PERMIT_PATH,
  clearPendingPayment,
  clearStoredPermit,
  fetchExportUnlockQuote,
  isExportUnlocked,
  readPendingPayment,
  readStoredPermit,
  redeemExportUnlockPermit,
  rememberPendingPayment,
  storeExportPermit,
  type ExportUnlockIdentity,
} from './export-unlock'

const identity: ExportUnlockIdentity = {
  getAccessToken: async () => 'privy-token',
  signerAddress: '0xAaaa000000000000000000000000000000000001',
  payerAddress: '0xBBBB0000000000000000000000000000000000b2',
}

const ACCOUNT = identity.payerAddress
const PROJECT = 'project-1'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchExportUnlockQuote', () => {
  it('asks for the project price and forwards the identity', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        projectId: PROJECT,
        priceUsd: 5,
        estimatedUsdc6: 5_000_000,
        minCrtvaiWei: '400000000000000000000',
        expiresAtMs: 1_800_000_000_000,
        quoteId: 'quote-1',
        signature: 'sig',
        slippageBps: 150,
      }),
    )

    const quote = await fetchExportUnlockQuote(identity, PROJECT, fetchImpl as typeof fetch)

    expect(quote.minCrtvaiWei).toBe('400000000000000000000')
    expect(quote.priceUsd).toBe(5)
    // The proof of the price has to survive to redemption, or the server re-prices and rejects.
    expect(quote).toMatchObject({ quoteId: 'quote-1', signature: 'sig', slippageBps: 150 })

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(EXPORT_PERMIT_PATH)
    expect(init.method).toBe('POST')
    const headers = new Headers(init.headers)
    expect(headers.get('x-pixels-signer')).toBe(identity.signerAddress)
    // The token travels in the header the route reads, and again in the body it parses.
    expect(headers.get('authorization')).toContain('privy-token')
    expect(JSON.parse(String(init.body))).toMatchObject({
      projectId: PROJECT,
      signerAddress: identity.signerAddress,
      payerAddress: identity.payerAddress,
    })
  })

  it('refuses to call the route without an identity token', async () => {
    const fetchImpl = vi.fn()

    await expect(
      fetchExportUnlockQuote(
        { ...identity, getAccessToken: async () => null },
        PROJECT,
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow('Not authenticated')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('surfaces the server reason instead of a bare status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'quote_unavailable' }, 502))

    await expect(
      fetchExportUnlockQuote(identity, PROJECT, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('quote_unavailable')
  })
})

describe('redeemExportUnlockPermit', () => {
  const quote = {
    quoteId: 'quote-1',
    signature: 'sig',
    minCrtvaiWei: '400000000000000000000',
    expiresAtMs: 1_800_000_000_000,
    slippageBps: 150,
  }

  it('returns a permit already bound to the transfer that paid for it', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        permit: 'body.signature',
        projectId: PROJECT,
        expiresAtMs: 1_900_000_000_000,
      }),
    )

    const permit = await redeemExportUnlockPermit(
      identity,
      { projectId: PROJECT, paymentTxHash: '0xdead', quote },
      fetchImpl as unknown as typeof fetch,
    )

    expect(permit).toEqual({
      permit: 'body.signature',
      projectId: PROJECT,
      txHash: '0xdead',
      expiresAtMs: 1_900_000_000_000,
    })
  })

  it('sends the quote that priced the payment, not just the hash', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ permit: 'body.signature', projectId: PROJECT, expiresAtMs: 1 }),
    )

    await redeemExportUnlockPermit(
      identity,
      { projectId: PROJECT, paymentTxHash: '0xdead', quote },
      fetchImpl as unknown as typeof fetch,
    )

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    // Without the proof the server has to re-price, which is what rejected buyers who sent
    // exactly the amount they were quoted.
    expect(JSON.parse(String(init.body)).quote).toEqual(quote)
  })
})

describe('permit cache', () => {
  const permit = {
    permit: 'body.signature',
    projectId: PROJECT,
    txHash: '0xdead',
    expiresAtMs: Date.now() + 1_000,
  }

  it('round-trips a permit and keys it by account and project', () => {
    storeExportPermit(ACCOUNT, permit)

    expect(readStoredPermit(ACCOUNT, PROJECT)).toEqual(permit)
    // A different project is a different purchase, so nothing is inherited.
    expect(readStoredPermit(ACCOUNT, 'project-2')).toBeNull()
    // Another account never sees this permit.
    expect(readStoredPermit('0xcccc0000000000000000000000000000000000c3', PROJECT)).toBeNull()
  })

  it('treats an expired permit as no permit', () => {
    storeExportPermit(ACCOUNT, { ...permit, expiresAtMs: Date.now() - 1 })

    expect(readStoredPermit(ACCOUNT, PROJECT)).toBeNull()
    expect(isExportUnlocked(ACCOUNT, PROJECT)).toBe(false)
  })

  it('treats a corrupt entry as no permit rather than throwing', () => {
    localStorage.setItem(`crtv:export-permit:v1:${ACCOUNT.toLowerCase()}:${PROJECT}`, '{not json')

    expect(readStoredPermit(ACCOUNT, PROJECT)).toBeNull()
  })

  it('reports locked when there is no identity or project to bind to', () => {
    storeExportPermit(ACCOUNT, permit)

    expect(isExportUnlocked(undefined, PROJECT)).toBe(false)
    expect(isExportUnlocked(ACCOUNT, undefined)).toBe(false)
    expect(isExportUnlocked(ACCOUNT, PROJECT)).toBe(true)
  })

  it('clears a permit on request', () => {
    storeExportPermit(ACCOUNT, permit)
    clearStoredPermit(ACCOUNT, PROJECT)

    expect(isExportUnlocked(ACCOUNT, PROJECT)).toBe(false)
  })
})

describe('pending payment', () => {
  const payment = {
    txHash: '0xfeed',
    quote: {
      quoteId: 'quote-1',
      signature: 'sig',
      minCrtvaiWei: '400000000000000000000',
      expiresAtMs: 1_800_000_000_000,
      slippageBps: 150,
    },
  }

  it('survives a reload so a failed redemption resumes instead of re-paying', () => {
    rememberPendingPayment(ACCOUNT, PROJECT, payment)

    expect(readPendingPayment(ACCOUNT, PROJECT)).toEqual(payment)
    // Scoped like the permit: another project is a different purchase.
    expect(readPendingPayment(ACCOUNT, 'project-2')).toBeNull()
  })

  it('is dropped once the permit is stored', () => {
    rememberPendingPayment(ACCOUNT, PROJECT, payment)
    clearPendingPayment(ACCOUNT, PROJECT)

    expect(readPendingPayment(ACCOUNT, PROJECT)).toBeNull()
  })

  it('ignores an entry without a transaction hash', () => {
    localStorage.setItem(
      `crtv:export-pending:v1:${ACCOUNT.toLowerCase()}:${PROJECT}`,
      JSON.stringify({ quote: payment.quote }),
    )

    expect(readPendingPayment(ACCOUNT, PROJECT)).toBeNull()
  })
})
