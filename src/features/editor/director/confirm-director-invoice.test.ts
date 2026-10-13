import { describe, expect, it, vi } from 'vitest'
import { confirmDirectorInvoice } from './confirm-director-invoice'
import type { PendingDirectorInvoice } from './director-invoice-card'

vi.mock('./fetch-director-server-quote', () => ({
  fetchDirectorServerQuote: vi.fn(),
}))

const baseInvoice: PendingDirectorInvoice = {
  brief: 'test',
  apiPrompt: 'test',
  quote: {
    audioDurationSeconds: 60,
    billableMinutes: 1,
    usdc6PerMinute: 50_000,
    estimatedUsdc6: 50_000,
    crtvaiWei: 1_000_000_000_000_000_000n,
    crtvaiDisplay: 1,
    formattedUsd: '$0.05',
    formattedDuration: '1:00',
    tier: 'retail',
    quoteId: 'q-1',
    signature: 'sig',
    expiresAtMs: Date.now() + 60_000,
    slippageBps: 250,
  },
}

describe('confirmDirectorInvoice', () => {
  it('throws when quote refresh fails instead of reusing the invoice quote', async () => {
    const { fetchDirectorServerQuote } = await import('./fetch-director-server-quote')
    vi.mocked(fetchDirectorServerQuote).mockResolvedValue(null)

    await expect(
      confirmDirectorInvoice({
        invoice: baseInvoice,
        balance: 10,
        canPayOnChain: false,
        account: '0xSmartAccount00000000000000000000000001',
        signerAddress: '0xSigner00000000000000000000000000000001',
        getAccessToken: async () => 'token',
        sendOps: vi.fn(),
        refreshBalance: vi.fn(),
        submit: vi.fn(),
      }),
    ).rejects.toThrow(/refresh the Director quote/)

    expect(fetchDirectorServerQuote).toHaveBeenCalledWith(
      { token: 'token', signerAddress: '0xSigner00000000000000000000000000000001' },
      { audioDurationSeconds: 60 },
    )
  })
})
