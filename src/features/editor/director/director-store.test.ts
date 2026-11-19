import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDirectorStore } from './director-store'

const BASE_SUBMIT_OPTIONS = {
  apiPrompt: 'Storyboard this track\n\nAudio: 60s',
  audioDurationSeconds: 60,
  paymentTxHash: '0xpaidtx0000000000000000000000000000000000000000000000000000000001',
  walletAddress: '0xSmartAccount0000000000000000000000000001',
  signerAddress: '0xSigner0000000000000000000000000000000001',
  projectId: 'proj-1',
  quoteId: 'q-1',
  quoteSignature: 'sig-1',
  quoteExpiresAtMs: 1_800_000_000_000,
  quoteSlippageBps: 250,
  quoteEstimatedUsdc6: 50_000,
  quoteCrtvaiRequired: '4000000000000000000',
  quoteTier: 'retail' as const,
  accessToken: 'privy-token',
}

function makeSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

describe('useDirectorStore released payment retry', () => {
  beforeEach(() => {
    useDirectorStore.getState().clearChat()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retains releasedPayment when the API fails with paymentReleased: true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: "Permission 'aiplatform.endpoints.predict' denied", paymentReleased: true },
          { status: 502 },
        ),
      ),
    )

    await useDirectorStore.getState().submit('Storyboard this track', BASE_SUBMIT_OPTIONS)

    const state = useDirectorStore.getState()
    expect(state.phase).toBe('idle')
    expect(state.lastError).toBe("Permission 'aiplatform.endpoints.predict' denied")
    expect(state.releasedPayment).toEqual({
      brief: 'Storyboard this track',
      apiPrompt: BASE_SUBMIT_OPTIONS.apiPrompt,
      audioUri: undefined,
      userId: undefined,
      projectId: 'proj-1',
      audioDurationSeconds: 60,
      paymentTxHash: BASE_SUBMIT_OPTIONS.paymentTxHash,
      walletAddress: BASE_SUBMIT_OPTIONS.walletAddress,
      signerAddress: BASE_SUBMIT_OPTIONS.signerAddress,
      quoteId: 'q-1',
      quoteSignature: 'sig-1',
      quoteExpiresAtMs: 1_800_000_000_000,
      quoteSlippageBps: 250,
      quoteEstimatedUsdc6: 50_000,
      quoteCrtvaiRequired: '4000000000000000000',
      quoteTier: 'retail',
    })
  })

  it('does not retain releasedPayment when paymentReleased is missing or false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'Rejected', paymentReleased: false }, { status: 402 }),
      ),
    )

    await useDirectorStore.getState().submit('Storyboard this track', BASE_SUBMIT_OPTIONS)
    expect(useDirectorStore.getState().releasedPayment).toBeNull()

    useDirectorStore.getState().clearChat()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Rate limited' }, { status: 429 })),
    )

    await useDirectorStore.getState().submit('Storyboard this track', BASE_SUBMIT_OPTIONS)
    expect(useDirectorStore.getState().releasedPayment).toBeNull()
  })

  it('clears releasedPayment once a retry succeeds with an SSE stream', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: 'Upstream failed', paymentReleased: true }, { status: 502 }),
      )
      .mockResolvedValueOnce(
        new Response(makeSseStream(['data: {"content":{"parts":[{"text":"Cut 1"}]}}\n\n']), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await useDirectorStore.getState().submit('Storyboard this track', BASE_SUBMIT_OPTIONS)
    const saved = useDirectorStore.getState().releasedPayment
    expect(saved).not.toBeNull()
    if (!saved) return

    await useDirectorStore.getState().submit(saved.brief, { ...saved, accessToken: 'fresh-token' })

    const state = useDirectorStore.getState()
    expect(state.releasedPayment).toBeNull()
    expect(state.lastError).toBeNull()
    expect(state.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Cut 1' })
  })

  it('clears releasedPayment on clearReleasedPayment and clearChat', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'Upstream failed', paymentReleased: true }, { status: 502 }),
      ),
    )

    await useDirectorStore.getState().submit('Storyboard this track', BASE_SUBMIT_OPTIONS)
    expect(useDirectorStore.getState().releasedPayment).not.toBeNull()

    useDirectorStore.getState().clearReleasedPayment()
    expect(useDirectorStore.getState().releasedPayment).toBeNull()

    await useDirectorStore.getState().submit('Storyboard this track', BASE_SUBMIT_OPTIONS)
    expect(useDirectorStore.getState().releasedPayment).not.toBeNull()

    useDirectorStore.getState().clearChat()
    expect(useDirectorStore.getState().releasedPayment).toBeNull()
  })
})
