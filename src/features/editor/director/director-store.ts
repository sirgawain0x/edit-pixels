/**
 * UI store for Creative Director (Vertex Agent Engine SSE).
 * Display-only — does not mutate the timeline.
 */

import { create } from 'zustand'
import { directorFailureMessage, isDirectorPaymentReleased } from './director-api-error'
import { consumeSseBuffer, parseSseDataLine, type DirectorStreamEvent } from './parse-sse'

type DirectorPhase = 'idle' | 'streaming'

interface DirectorChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'error'
  content: string
  toolName?: string
}

interface DirectorToolCall {
  id: string
  name: string
  args?: Record<string, unknown>
  result?: unknown
  status: 'running' | 'done'
}

interface DirectorSubmitOptions {
  audioUri?: string
  userId?: string
  projectId?: string
  /** Full prompt sent to the API (defaults to text) */
  apiPrompt?: string
  audioDurationSeconds?: number
  paymentTxHash?: string
  quoteId?: string
  quoteSignature?: string
  quoteExpiresAtMs?: number
  quoteSlippageBps?: number
  quoteEstimatedUsdc6?: number
  quoteCrtvaiRequired?: string
  quoteTier?: 'retail' | 'premium'
  walletAddress?: string
  signerAddress?: string
  accessToken?: string
}

interface ReleasedDirectorPayment {
  brief: string
  apiPrompt: string
  audioUri?: string
  userId?: string
  projectId?: string
  audioDurationSeconds: number
  paymentTxHash: string
  walletAddress?: string
  signerAddress?: string
  quoteId?: string
  quoteSignature?: string
  quoteExpiresAtMs?: number
  quoteSlippageBps?: number
  quoteEstimatedUsdc6?: number
  quoteCrtvaiRequired?: string
  quoteTier?: 'retail' | 'premium'
}

/** A conversation kept in memory while another one is active in the Director window. */
export interface DirectorConversation {
  key: string
  sessionId: string | null
  title: string
  messages: DirectorChatMessage[]
  updatedAt: number
}

interface DirectorOpenConversationInput {
  sessionId: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

interface DirectorState {
  messages: DirectorChatMessage[]
  phase: DirectorPhase
  streamingText: string
  toolCalls: DirectorToolCall[]
  sessionId: string | null
  lastError: string | null
  releasedPayment: ReleasedDirectorPayment | null
  /** Stable key for the active conversation before the server assigns a sessionId. */
  activeKey: string
  /** Other conversations open in this window (most recent first). */
  parkedConversations: DirectorConversation[]

  submit: (text: string, options?: DirectorSubmitOptions) => Promise<void>
  /** Park the current conversation and load a past brief (idle only). Returns false when busy. */
  openConversation: (input: DirectorOpenConversationInput) => boolean
  /** Swap the active conversation with a parked one (idle only). */
  switchConversation: (key: string) => boolean
  /** Park the current conversation and start an empty one. */
  startNewConversation: () => boolean
  /** Drop a deleted session from the window (active or parked). */
  forgetConversation: (sessionId: string) => void
  /** Local UX error (e.g. missing timeline audio) — does not call the API. */
  reportLocalError: (message: string) => void
  clearReleasedPayment: () => void
  cancel: () => void
  clearChat: () => void
}

type DirectorSet = (
  partial: Partial<DirectorState> | ((state: DirectorState) => Partial<DirectorState>),
) => void

let activeController: AbortController | null = null

function newId(): string {
  return crypto.randomUUID()
}

function applyStreamEvents(events: DirectorStreamEvent[], set: DirectorSet): void {
  for (const event of events) {
    switch (event.type) {
      case 'text':
        set((state) => ({ streamingText: state.streamingText + event.text }))
        break
      case 'tool':
        set((state) => ({
          toolCalls: [
            ...state.toolCalls,
            {
              id: newId(),
              name: event.name,
              args: event.args,
              status: 'running' as const,
            },
          ],
          messages: [
            ...state.messages,
            {
              id: newId(),
              role: 'tool' as const,
              content: `Calling ${event.name}…`,
              toolName: event.name,
            },
          ],
        }))
        break
      case 'tool-result':
        set((state) => ({
          toolCalls: state.toolCalls.map((call) =>
            call.name === event.name && call.status === 'running'
              ? { ...call, status: 'done' as const, result: event.result }
              : call,
          ),
          messages: [
            ...state.messages,
            {
              id: newId(),
              role: 'tool' as const,
              content: `${event.name} finished`,
              toolName: event.name,
            },
          ],
        }))
        break
      case 'session':
        set({ sessionId: event.sessionId })
        break
      case 'error':
        set((state) => ({
          lastError: event.message,
          messages: [
            ...state.messages,
            { id: newId(), role: 'error' as const, content: event.message },
          ],
        }))
        break
      default:
        break
    }
  }
}

async function readDirectorError(
  response: Response,
): Promise<{ message: string; paymentReleased: boolean }> {
  try {
    const body = (await response.json()) as unknown
    return {
      message: directorFailureMessage(response.status, body),
      paymentReleased: isDirectorPaymentReleased(body),
    }
  } catch {
    return {
      message: directorFailureMessage(response.status, null),
      paymentReleased: false,
    }
  }
}

/** Mirrors `METOKEN_QUOTE_SETTLEMENT_GRACE_SECONDS` in api/_metoken-curve-config.ts (15 min total from issue). */
const DIRECTOR_QUOTE_SETTLEMENT_GRACE_MS = (15 * 60 - 75) * 1000

export function releasedDirectorPaymentDeadlineMs(payment: {
  quoteExpiresAtMs?: number
}): number | null {
  if (typeof payment.quoteExpiresAtMs !== 'number' || !Number.isFinite(payment.quoteExpiresAtMs)) {
    return null
  }
  return payment.quoteExpiresAtMs + DIRECTOR_QUOTE_SETTLEMENT_GRACE_MS
}

export function isReleasedDirectorPaymentExpired(
  payment: { quoteExpiresAtMs?: number },
  nowMs = Date.now(),
): boolean {
  const deadlineMs = releasedDirectorPaymentDeadlineMs(payment)
  return deadlineMs !== null && nowMs >= deadlineMs
}

function isPreBillingRetryableStatus(status: number): boolean {
  return status === 401 || status === 429
}

function buildReleasedPayment(
  brief: string,
  apiPrompt: string,
  options?: DirectorSubmitOptions,
): ReleasedDirectorPayment | null {
  const paymentTxHash = options?.paymentTxHash?.trim()
  if (!paymentTxHash || typeof options?.audioDurationSeconds !== 'number') {
    return null
  }
  if (isReleasedDirectorPaymentExpired({ quoteExpiresAtMs: options.quoteExpiresAtMs })) {
    return null
  }
  return {
    brief,
    apiPrompt,
    audioUri: options.audioUri,
    userId: options.userId,
    projectId: options.projectId,
    audioDurationSeconds: options.audioDurationSeconds,
    paymentTxHash,
    walletAddress: options.walletAddress,
    signerAddress: options.signerAddress,
    quoteId: options.quoteId,
    quoteSignature: options.quoteSignature,
    quoteExpiresAtMs: options.quoteExpiresAtMs,
    quoteSlippageBps: options.quoteSlippageBps,
    quoteEstimatedUsdc6: options.quoteEstimatedUsdc6,
    quoteCrtvaiRequired: options.quoteCrtvaiRequired,
    quoteTier: options.quoteTier,
  }
}

async function consumeDirectorSse(
  body: ReadableStream<Uint8Array>,
  set: DirectorSet,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const { events, rest } = consumeSseBuffer(buffer)
    buffer = rest
    for (const data of events) {
      applyStreamEvents(parseSseDataLine(data), set)
    }
  }

  if (buffer.trim()) {
    const { events } = consumeSseBuffer(`${buffer}\n\n`)
    for (const data of events) {
      applyStreamEvents(parseSseDataLine(data), set)
    }
  }
}

function finalizeAssistantReply(set: DirectorSet, get: () => DirectorState): void {
  const streamed = get().streamingText.trim()
  set((state) => ({
    messages: streamed
      ? [...state.messages, { id: newId(), role: 'assistant', content: streamed }]
      : state.messages,
    streamingText: '',
    phase: 'idle',
  }))
}

function setDirectorFailure(
  set: DirectorSet,
  message: string,
  releasedPayment: ReleasedDirectorPayment | null = null,
): void {
  set((state) => ({
    messages: [...state.messages, { id: newId(), role: 'error', content: message }],
    phase: 'idle',
    streamingText: '',
    lastError: message,
    releasedPayment,
  }))
}

const PARKED_CONVERSATION_LIMIT = 8

function conversationTitle(messages: DirectorChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user')?.content ?? ''
  const title =
    firstUser
      .trim()
      .split(/\n\s*\n/)[0]
      ?.trim() ?? ''
  return title.slice(0, 120) || 'Untitled brief'
}

/** Snapshot the active conversation into the parked list (no-op when empty). */
function parkActive(state: DirectorState, excludeKey?: string): DirectorConversation[] {
  const others = state.parkedConversations.filter((c) => c.key !== excludeKey)
  if (state.messages.length === 0) return others
  const key = state.sessionId ?? state.activeKey
  const snapshot: DirectorConversation = {
    key,
    sessionId: state.sessionId,
    title: conversationTitle(state.messages),
    messages: state.messages,
    updatedAt: Date.now(),
  }
  return [snapshot, ...others.filter((c) => c.key !== key)].slice(0, PARKED_CONVERSATION_LIMIT)
}

const RESET_TURN_STATE = {
  phase: 'idle' as const,
  streamingText: '',
  toolCalls: [],
  lastError: null,
  releasedPayment: null,
}

export const useDirectorStore = create<DirectorState>((set, get) => ({
  messages: [],
  phase: 'idle',
  streamingText: '',
  toolCalls: [],
  sessionId: null,
  lastError: null,
  releasedPayment: null,
  activeKey: newId(),
  parkedConversations: [],

  reportLocalError: (message) => {
    const trimmed = message.trim()
    if (!trimmed || get().phase !== 'idle') return
    set((state) => ({
      messages: [...state.messages, { id: newId(), role: 'error', content: trimmed }],
      lastError: trimmed,
    }))
  },

  clearReleasedPayment: () => {
    set({ releasedPayment: null })
  },

  // fallow-ignore-next-line complexity
  submit: async (text, options) => {
    const trimmed = text.trim()
    if (!trimmed || get().phase !== 'idle') return
    const apiPrompt = (options?.apiPrompt ?? trimmed).trim()
    if (!apiPrompt) return

    const userMessage: DirectorChatMessage = {
      id: newId(),
      role: 'user',
      content: trimmed,
    }
    set((state) => ({
      messages: [...state.messages, userMessage],
      phase: 'streaming',
      streamingText: '',
      lastError: null,
      releasedPayment: null,
      toolCalls: [],
    }))

    const controller = new AbortController()
    activeController = controller

    try {
      const accessToken = options?.accessToken?.trim()
      const signerAddress = options?.signerAddress?.trim()
      const response = await fetch('/api/director', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(signerAddress ? { 'x-pixels-signer': signerAddress } : {}),
        },
        body: JSON.stringify({
          prompt: apiPrompt,
          displayPrompt: trimmed,
          token: accessToken,
          userId: options?.userId,
          sessionId: get().sessionId ?? undefined,
          projectId: options?.projectId,
          audioUri: options?.audioUri,
          audioDurationSeconds: options?.audioDurationSeconds,
          paymentTxHash: options?.paymentTxHash,
          walletAddress: options?.walletAddress,
          signerAddress,
          quoteId: options?.quoteId,
          quoteSignature: options?.quoteSignature,
          quoteExpiresAtMs: options?.quoteExpiresAtMs,
          quoteSlippageBps: options?.quoteSlippageBps,
          quoteEstimatedUsdc6: options?.quoteEstimatedUsdc6,
          quoteCrtvaiRequired: options?.quoteCrtvaiRequired,
          quoteTier: options?.quoteTier,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const failure = await readDirectorError(response)
        const keepReleased = failure.paymentReleased || isPreBillingRetryableStatus(response.status)
        const reusable = keepReleased ? buildReleasedPayment(trimmed, apiPrompt, options) : null
        setDirectorFailure(set, failure.message, reusable)
        return
      }

      if (!response.body) {
        setDirectorFailure(set, 'Empty response from Director')
        return
      }

      await consumeDirectorSse(response.body, set)
      finalizeAssistantReply(set, get)
    } catch (error) {
      if (controller.signal.aborted) {
        finalizeAssistantReply(set, get)
      } else {
        const message = error instanceof Error ? error.message : 'Something went wrong.'
        setDirectorFailure(set, message)
      }
    } finally {
      activeController = null
    }
  },

  cancel: () => {
    activeController?.abort()
    activeController = null
    finalizeAssistantReply(set, get)
  },

  openConversation: ({ sessionId, messages }) => {
    const state = get()
    const trimmed = sessionId.trim()
    if (!trimmed || state.phase !== 'idle') return false
    if (state.sessionId === trimmed) return true

    // Prefer the in-window copy (keeps tool rows) when this session is already parked.
    const parked = state.parkedConversations.find((c) => c.key === trimmed)
    const loaded: DirectorChatMessage[] =
      parked?.messages ??
      messages.map((message) => ({ id: newId(), role: message.role, content: message.content }))

    set({
      ...RESET_TURN_STATE,
      parkedConversations: parkActive(state, trimmed),
      messages: loaded,
      sessionId: trimmed,
      activeKey: trimmed,
    })
    return true
  },

  switchConversation: (key) => {
    const state = get()
    if (state.phase !== 'idle') return false
    const target = state.parkedConversations.find((c) => c.key === key)
    if (!target) return false
    set({
      ...RESET_TURN_STATE,
      parkedConversations: parkActive(state, key),
      messages: target.messages,
      sessionId: target.sessionId,
      activeKey: target.key,
    })
    return true
  },

  startNewConversation: () => {
    const state = get()
    if (state.phase !== 'idle') return false
    set({
      ...RESET_TURN_STATE,
      parkedConversations: parkActive(state),
      messages: [],
      sessionId: null,
      activeKey: newId(),
    })
    return true
  },

  forgetConversation: (sessionId) => {
    const state = get()
    const parkedConversations = state.parkedConversations.filter((c) => c.sessionId !== sessionId)
    if (state.sessionId === sessionId && state.phase === 'idle') {
      set({
        ...RESET_TURN_STATE,
        parkedConversations,
        messages: [],
        sessionId: null,
        activeKey: newId(),
      })
      return
    }
    set({ parkedConversations })
  },

  clearChat: () => {
    activeController?.abort()
    activeController = null
    set({
      messages: [],
      toolCalls: [],
      phase: 'idle',
      streamingText: '',
      sessionId: null,
      lastError: null,
      releasedPayment: null,
      activeKey: newId(),
    })
  },
}))
