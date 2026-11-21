import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmPaidDirectorBatch } from './director-batch-runner'
import { confirmDirectorBatch, lockDirectorBatch, PixelsGenerateApiError } from './seedance-client'
import type { DirectorBatchQuoteResponse } from './seedance-client'

const PENDING_CONFIRM_KEY = 'pixels:director-batch:pending-confirm'

vi.mock('./seedance-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./seedance-client')>()
  return {
    ...original,
    confirmDirectorBatch: vi.fn(),
    lockDirectorBatch: vi.fn(async () => ({
      ok: true,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })),
  }
})

vi.mock('./import-render-to-library', () => ({
  importRenderVideoToLibrary: vi.fn(),
}))

vi.mock('./pixels-generate-helpers', () => ({
  pollSeedanceTaskToVideo: vi.fn(),
  pollVeoTaskToVideo: vi.fn(),
  resolveVeoTaskId: vi.fn(),
}))

vi.mock(
  '../director/build-director-payment',
  () =>
    ({
      buildDirectorPaymentOp: (_amountWei: bigint) => ({
        target: '0xecb695544a3d2a64d579b3828f3f60f6932f4846' as const,
        data: '0x00' as const,
        value: 0n as bigint,
      }),
    }) as never,
)

const confirmMock = vi.mocked(confirmDirectorBatch)
const lockMock = vi.mocked(lockDirectorBatch)

const TX = '0xadc590b68ef1afdee961177fe20e6bd100589278e7bb630462a79b516cb9b3c6'
const NEW_QUOTE_ID = 'quote-new'

function makeQuote(
  batchQuoteId: string,
  expiresOffsetMs = 10 * 60 * 1000,
): DirectorBatchQuoteResponse {
  return {
    batchQuoteId,
    expiresAt: new Date(Date.now() + expiresOffsetMs).toISOString(),
    shotCount: 1,
    shots: [
      {
        shotId: 'shot-1',
        recommendedProvider: 'veo',
        generate: {
          prompt: 'Wide city skyline at dusk, cinematic',
          duration: 5,
          veoDuration: 6,
          seedanceDuration: 5,
          aspect_ratio: '16:9',
          resolution: '720p',
        },
        veo: {
          provider: 'veo',
          duration: 6,
          estimatedUsdc6: 500_000,
          crtvaiRequired: '1000000000000000000',
          crtvaiDisplay: 1,
          formattedUsd: '$0.50',
          label: 'Veo',
          detail: '6s · 16:9 · 720p',
        },
        seedance: {
          provider: 'seedance',
          quoteId: 'seedance-quote-1',
          duration: 5,
          estimatedUsdc6: 500_000,
          crtvaiRequired: '1000000000000000000',
          crtvaiDisplay: 1,
          formattedUsd: '$0.50',
          label: 'Seedance',
          detail: '5s · 16:9',
        },
      },
    ],
    totals: {
      allVeo: {
        crtvaiRequired: '1000000000000000000',
        crtvaiDisplay: 1,
        formattedUsd: '$0.50',
      },
      allSeedance: {
        crtvaiRequired: '1000000000000000000',
        crtvaiDisplay: 1,
        formattedUsd: '$0.50',
      },
      recommendedMix: {
        crtvaiRequired: '1000000000000000000',
        crtvaiDisplay: 1,
        formattedUsd: '$0.50',
        providers: { veo: 1, seedance: 0 },
      },
    },
  }
}

function makeConfirmResponse(quote: DirectorBatchQuoteResponse) {
  return {
    batchConfirmId: 'confirm-1',
    batchQuoteId: quote.batchQuoteId,
    paymentTxHash: TX,
    totalCrtvaiRequired: '1000000000000000000',
    totalCrtvaiDisplay: 1,
    jobs: [
      {
        shotId: 'shot-1',
        requestId: 'req-1',
        provider: 'veo' as const,
        status: 'queued' as const,
        seedanceQuoteId: null,
        crtvaiRequired: '1000000000000000000',
        pollUrl: '/api/generate-task?id=req-1',
        generateEndpoint: '/api/pixels-render-veo' as const,
      },
    ],
    enqueue: { note: 'test', batchConfirmId: 'confirm-1' },
  }
}

const noOpCallbacks = {
  onPhase: vi.fn(),
  onJobs: vi.fn(),
  onError: vi.fn(),
}

describe('confirmPaidDirectorBatch payment reuse', () => {
  beforeEach(() => {
    sessionStorage.clear()
    confirmMock.mockReset()
    confirmMock.mockImplementation(async (_auth, body) =>
      makeConfirmResponse(makeQuote((body as { batchQuoteId: string }).batchQuoteId)),
    )
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('re-applies an unconsumed on-chain payment when the quote has been refreshed (no new charge)', async () => {
    sessionStorage.setItem(
      PENDING_CONFIRM_KEY,
      JSON.stringify({
        batchQuoteId: 'quote-expired',
        paymentTxHash: TX,
        selections: [{ shotId: 'shot-1', provider: 'veo', requestId: 'req-old' }],
      }),
    )
    const sendOps = vi.fn(async () => ({ txHash: 'should-not-pay-again' }))

    const quote = makeQuote(NEW_QUOTE_ID)
    const active = await confirmPaidDirectorBatch({
      auth: {
        signer: '0x04F5C5691E2F3e79246B08b98e912b3D2a786696',
        payerAddress: '0x04F5C5691E2F3e79246B08b98e912b3D2a786696',
      } as never,
      quote,
      path: 'recommendedMix',
      canPayOnChain: true,
      sendOps,
      refreshBalance: vi.fn(),
      callbacks: noOpCallbacks,
    })

    expect(sendOps).not.toHaveBeenCalled()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(confirmMock.mock.calls[0]?.[1]).toMatchObject({
      batchQuoteId: NEW_QUOTE_ID,
      paymentTxHash: TX,
    })
    expect(active?.batchQuoteId).toBe(NEW_QUOTE_ID)
    // Success clears the pending payment so a later batch pays for itself.
    expect(sessionStorage.getItem(PENDING_CONFIRM_KEY)).toBeNull()
  })

  it('pays fresh when there is no pending on-chain payment', async () => {
    const sendOps = vi.fn(async () => ({ txHash: '0xfresh' }))

    const quote = makeQuote(NEW_QUOTE_ID)
    await confirmPaidDirectorBatch({
      auth: {
        signer: '0x04F5C5691E2F3e79246B08b98e912b3D2a786696',
        payerAddress: '0x04F5C5691E2F3e79246B08b98e912b3D2a786696',
      } as never,
      quote,
      path: 'recommendedMix',
      canPayOnChain: true,
      sendOps,
      refreshBalance: vi.fn(),
      callbacks: noOpCallbacks,
    })

    expect(sendOps).toHaveBeenCalledTimes(1)
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(confirmMock.mock.calls[0]?.[1]).toMatchObject({
      batchQuoteId: NEW_QUOTE_ID,
      paymentTxHash: '0xfresh',
    })
    // Success clears the pending payment.
    expect(sessionStorage.getItem(PENDING_CONFIRM_KEY)).toBeNull()
  })

  it('refuses to open the wallet when the quote has less than 90s remaining', async () => {
    const sendOps = vi.fn(async () => ({ txHash: 'should-not-pay' }))
    const quote = makeQuote(NEW_QUOTE_ID, 30_000) // 30 seconds remaining

    await expect(
      confirmPaidDirectorBatch({
        auth: {
          signer: '0x04F5C5691E2F3e79246B08b98e912b3D2a786696',
          payerAddress: '0x04F5C5691E2F3e79246B08b98e912b3D2a786696',
        } as never,
        quote,
        path: 'recommendedMix',
        canPayOnChain: true,
        sendOps,
        refreshBalance: vi.fn(),
        callbacks: noOpCallbacks,
      }),
    ).rejects.toMatchObject({
      code: 'quote_expired',
      status: 400,
    })

    expect(sendOps).not.toHaveBeenCalled()
    expect(lockMock).not.toHaveBeenCalled()
  })

  it('holds the quote server-side before a fresh payment', async () => {
    const sendOps = vi.fn(async () => ({ txHash: '0xfresh' }))
    const quote = makeQuote(NEW_QUOTE_ID)

    await confirmPaidDirectorBatch({
      auth: {
        signer: '0x04F5C5691E2F3e79246B08b98e912b3D2a786696',
        payerAddress: '0x04F5C5691E2F3e79246B08b98e912b3D2a786696',
      } as never,
      quote,
      path: 'recommendedMix',
      canPayOnChain: true,
      sendOps,
      refreshBalance: vi.fn(),
      callbacks: noOpCallbacks,
    })

    expect(lockMock).toHaveBeenCalledTimes(1)
    expect(lockMock).toHaveBeenCalledWith(expect.anything(), NEW_QUOTE_ID)
    expect(sendOps).toHaveBeenCalledTimes(1)
  })

  it('does not open the wallet when the server-side quote hold fails', async () => {
    lockMock.mockRejectedValueOnce(
      new PixelsGenerateApiError('quote_not_found', 'Batch quote not found', 400),
    )
    const sendOps = vi.fn(async () => ({ txHash: 'should-not-pay' }))
    const quote = makeQuote(NEW_QUOTE_ID)

    await expect(
      confirmPaidDirectorBatch({
        auth: {
          signer: '0x04F5C5691E2F3e79246B08b98e912b3D2a786696',
          payerAddress: '0x04F5C5691E2F3e79246B08b98e912b3D2a786696',
        } as never,
        quote,
        path: 'recommendedMix',
        canPayOnChain: true,
        sendOps,
        refreshBalance: vi.fn(),
        callbacks: noOpCallbacks,
      }),
    ).rejects.toMatchObject({ code: 'quote_not_found', status: 400 })

    expect(sendOps).not.toHaveBeenCalled()
  })

  it('does not charge again when a pending unconsumed payment exists', async () => {
    sessionStorage.setItem(
      PENDING_CONFIRM_KEY,
      JSON.stringify({
        batchQuoteId: 'quote-expired',
        paymentTxHash: TX,
        selections: [{ shotId: 'shot-1', provider: 'veo', requestId: 'req-old' }],
      }),
    )
    const sendOps = vi.fn(async () => ({ txHash: 'should-not-pay-again' }))
    const quote = makeQuote(NEW_QUOTE_ID)

    await confirmPaidDirectorBatch({
      auth: {
        signer: '0x04F5C5691E2F3e79246B08b98e912b3D2a786696',
        payerAddress: '0x04F5C5691E2F3e79246B08b98e912b3D2a786696',
      } as never,
      quote,
      path: 'recommendedMix',
      canPayOnChain: true,
      sendOps,
      refreshBalance: vi.fn(),
      callbacks: noOpCallbacks,
    })

    expect(sendOps).not.toHaveBeenCalled()
    expect(lockMock).not.toHaveBeenCalled()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(confirmMock.mock.calls[0]?.[1]).toMatchObject({
      batchQuoteId: NEW_QUOTE_ID,
      paymentTxHash: TX,
    })
  })
})
