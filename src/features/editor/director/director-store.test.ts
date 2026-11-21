import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isReleasedDirectorPaymentExpired,
  releasedDirectorPaymentDeadlineMs,
  useDirectorStore,
} from './director-store'

function makeSubmitOptions(
  overrides: Partial<{
    quoteExpiresAtMs: number
    accessToken: string
  }> = {},
) {
  return {
    apiPrompt: 'Storyboard this track\n\nAudio: 60s',
    audioDurationSeconds: 60,
    paymentTxHash: '0xpaidtx0000000000000000000000000000000000000000000000000000000001',
    walletAddress: '0xSmartAccount0000000000000000000000000001',
    signerAddress: '0xSigner0000000000000000000000000000000001',
    projectId: 'proj-1',
    quoteId: 'q-1',
    quoteSignature: 'sig-1',
    quoteExpiresAtMs: overrides.quoteExpiresAtMs ?? Date.now() + 75_000,
    quoteSlippageBps: 250,
    quoteEstimatedUsdc6: 50_000,
    quoteCrtvaiRequired: '4000000000000000000',
    quoteTier: 'retail' as const,
    accessToken: overrides.accessToken ?? 'privy-token',
  }
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
    const options = makeSubmitOptions()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: "Permission 'aiplatform.endpoints.predict' denied", paymentReleased: true },
          { status: 502 },
        ),
      ),
    )

    await useDirectorStore.getState().submit('Storyboard this track', options)

    const state = useDirectorStore.getState()
    expect(state.phase).toBe('idle')
    expect(state.lastError).toBe("Permission 'aiplatform.endpoints.predict' denied")
    expect(state.releasedPayment).toEqual({
      brief: 'Storyboard this track',
      apiPrompt: options.apiPrompt,
      audioUri: undefined,
      userId: undefined,
      projectId: 'proj-1',
      audioDurationSeconds: 60,
      paymentTxHash: options.paymentTxHash,
      walletAddress: options.walletAddress,
      signerAddress: options.signerAddress,
      quoteId: 'q-1',
      quoteSignature: 'sig-1',
      quoteExpiresAtMs: options.quoteExpiresAtMs,
      quoteSlippageBps: 250,
      quoteEstimatedUsdc6: 50_000,
      quoteCrtvaiRequired: '4000000000000000000',
      quoteTier: 'retail',
    })
  })

  it('does not retain releasedPayment when paymentReleased is missing or false outside 401/429', async () => {
    const options = makeSubmitOptions()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'Rejected', paymentReleased: false }, { status: 402 }),
      ),
    )

    await useDirectorStore.getState().submit('Storyboard this track', options)
    expect(useDirectorStore.getState().releasedPayment).toBeNull()

    useDirectorStore.getState().clearChat()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Engine error' }, { status: 502 })),
    )

    await useDirectorStore.getState().submit('Storyboard this track', options)
    expect(useDirectorStore.getState().releasedPayment).toBeNull()
  })

  it('retains releasedPayment when a paid request or retry hits pre-billing 401 or 429', async () => {
    const options = makeSubmitOptions()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: 'Upstream failed', paymentReleased: true }, { status: 502 }),
      )
      .mockResolvedValueOnce(Response.json({ error: 'Rate limited' }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ error: 'Token expired' }, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await useDirectorStore.getState().submit('Storyboard this track', options)
    const firstSaved = useDirectorStore.getState().releasedPayment
    expect(firstSaved).not.toBeNull()
    if (!firstSaved) return

    await useDirectorStore
      .getState()
      .submit(firstSaved.brief, { ...firstSaved, accessToken: 'token-2' })
    const after429 = useDirectorStore.getState().releasedPayment
    expect(after429).toEqual(firstSaved)
    if (!after429) return

    await useDirectorStore
      .getState()
      .submit(after429.brief, { ...after429, accessToken: 'expired-token' })
    expect(useDirectorStore.getState().releasedPayment).toEqual(firstSaved)
  })

  it('does not retain releasedPayment once the 15-minute settlement grace window has passed', async () => {
    const expiredAt = Date.now() - 15 * 60 * 1000
    const options = makeSubmitOptions({ quoteExpiresAtMs: expiredAt })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'Upstream failed', paymentReleased: true }, { status: 502 }),
      ),
    )

    await useDirectorStore.getState().submit('Storyboard this track', options)
    expect(useDirectorStore.getState().releasedPayment).toBeNull()
  })

  it('computes the 15-minute settlement deadline and checks boundary expiry', () => {
    const quoteExpiresAtMs = 1_700_000_000_000
    const expectedDeadlineMs = quoteExpiresAtMs + (15 * 60 - 75) * 1000
    expect(releasedDirectorPaymentDeadlineMs({ quoteExpiresAtMs })).toBe(expectedDeadlineMs)
    expect(releasedDirectorPaymentDeadlineMs({})).toBeNull()

    expect(isReleasedDirectorPaymentExpired({ quoteExpiresAtMs }, expectedDeadlineMs - 1)).toBe(
      false,
    )
    expect(isReleasedDirectorPaymentExpired({ quoteExpiresAtMs }, expectedDeadlineMs)).toBe(true)
    expect(isReleasedDirectorPaymentExpired({}, expectedDeadlineMs)).toBe(false)
  })

  it('clears releasedPayment once a retry succeeds with an SSE stream', async () => {
    const options = makeSubmitOptions()
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

    await useDirectorStore.getState().submit('Storyboard this track', options)
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
    const options = makeSubmitOptions()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'Upstream failed', paymentReleased: true }, { status: 502 }),
      ),
    )

    await useDirectorStore.getState().submit('Storyboard this track', options)
    expect(useDirectorStore.getState().releasedPayment).not.toBeNull()

    useDirectorStore.getState().clearReleasedPayment()
    expect(useDirectorStore.getState().releasedPayment).toBeNull()

    await useDirectorStore.getState().submit('Storyboard this track', options)
    expect(useDirectorStore.getState().releasedPayment).not.toBeNull()

    useDirectorStore.getState().clearChat()
    expect(useDirectorStore.getState().releasedPayment).toBeNull()
  })
})

describe('director conversation switching', () => {
  beforeEach(() => {
    useDirectorStore.setState({ parkedConversations: [] })
    useDirectorStore.getState().clearChat()
  })

  function seedActive(sessionId: string | null, brief: string) {
    useDirectorStore.setState({
      sessionId,
      messages: [
        { id: `${brief}-u`, role: 'user', content: brief },
        { id: `${brief}-a`, role: 'assistant', content: `Reply to ${brief}` },
      ],
    })
  }

  it('opens a past brief and parks the current conversation', () => {
    seedActive('sess-current', 'Current brief')
    const ok = useDirectorStore.getState().openConversation({
      sessionId: 'sess-past',
      messages: [
        { role: 'user', content: 'Past brief' },
        { role: 'assistant', content: 'Past reply' },
      ],
    })
    const state = useDirectorStore.getState()
    expect(ok).toBe(true)
    expect(state.sessionId).toBe('sess-past')
    expect(state.messages.map((m) => m.content)).toEqual(['Past brief', 'Past reply'])
    expect(state.parkedConversations).toHaveLength(1)
    expect(state.parkedConversations[0]).toMatchObject({
      key: 'sess-current',
      sessionId: 'sess-current',
      title: 'Current brief',
    })
  })

  it('switches back to the parked conversation with its messages intact', () => {
    seedActive('sess-current', 'Current brief')
    useDirectorStore.getState().openConversation({
      sessionId: 'sess-past',
      messages: [{ role: 'user', content: 'Past brief' }],
    })
    expect(useDirectorStore.getState().switchConversation('sess-current')).toBe(true)
    const state = useDirectorStore.getState()
    expect(state.sessionId).toBe('sess-current')
    expect(state.messages.map((m) => m.content)).toEqual([
      'Current brief',
      'Reply to Current brief',
    ])
    expect(state.parkedConversations.map((c) => c.key)).toEqual(['sess-past'])
  })

  it('parks a not-yet-saved draft under a local key when starting a new brief', () => {
    seedActive(null, 'Draft brief')
    const draftKey = useDirectorStore.getState().activeKey
    useDirectorStore.getState().startNewConversation()
    const state = useDirectorStore.getState()
    expect(state.messages).toEqual([])
    expect(state.sessionId).toBeNull()
    expect(state.parkedConversations[0]).toMatchObject({ key: draftKey, sessionId: null })
  })

  it('refuses to switch while the Director is streaming', () => {
    seedActive('sess-current', 'Current brief')
    useDirectorStore.setState({ phase: 'streaming' })
    const ok = useDirectorStore
      .getState()
      .openConversation({ sessionId: 'sess-past', messages: [] })
    expect(ok).toBe(false)
    expect(useDirectorStore.getState().sessionId).toBe('sess-current')
    useDirectorStore.setState({ phase: 'idle' })
  })

  it('forgets a deleted session whether active or parked', () => {
    seedActive('sess-a', 'Brief A')
    useDirectorStore.getState().openConversation({
      sessionId: 'sess-b',
      messages: [{ role: 'user', content: 'Brief B' }],
    })
    useDirectorStore.getState().forgetConversation('sess-a')
    expect(useDirectorStore.getState().parkedConversations).toEqual([])
    useDirectorStore.getState().forgetConversation('sess-b')
    expect(useDirectorStore.getState().sessionId).toBeNull()
    expect(useDirectorStore.getState().messages).toEqual([])
  })
})
