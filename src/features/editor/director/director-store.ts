/**
 * UI store for Creative Director (Vertex Agent Engine SSE).
 * Display-only — does not mutate the timeline.
 */

import { create } from 'zustand'
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

interface DirectorState {
  messages: DirectorChatMessage[]
  phase: DirectorPhase
  streamingText: string
  toolCalls: DirectorToolCall[]
  sessionId: string | null
  lastError: string | null

  submit: (
    text: string,
    options?: {
      audioUri?: string
      userId?: string
      projectId?: string
      /** Full prompt sent to the API (defaults to text) */
      apiPrompt?: string
      audioDurationSeconds?: number
      paymentTxHash?: string
      walletAddress?: string
    },
  ) => Promise<void>
  /** Resume an Agent Engine session from Firestore index. */
  resumeSession: (sessionId: string) => void
  /** Local UX error (e.g. missing timeline audio) — does not call the API. */
  reportLocalError: (message: string) => void
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

async function readDirectorError(response: Response): Promise<string> {
  let message = `Director request failed (${response.status})`
  try {
    const data = (await response.json()) as { error?: string }
    if (data.error) message = data.error
  } catch {
    // ignore body parse errors
  }
  return message
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

function setDirectorFailure(set: DirectorSet, message: string): void {
  set((state) => ({
    messages: [...state.messages, { id: newId(), role: 'error', content: message }],
    phase: 'idle',
    streamingText: '',
    lastError: message,
  }))
}

export const useDirectorStore = create<DirectorState>((set, get) => ({
  messages: [],
  phase: 'idle',
  streamingText: '',
  toolCalls: [],
  sessionId: null,
  lastError: null,

  reportLocalError: (message) => {
    const trimmed = message.trim()
    if (!trimmed || get().phase !== 'idle') return
    set((state) => ({
      messages: [...state.messages, { id: newId(), role: 'error', content: trimmed }],
      lastError: trimmed,
    }))
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
      toolCalls: [],
    }))

    const controller = new AbortController()
    activeController = controller

    try {
      const response = await fetch('/api/director', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
        },
        body: JSON.stringify({
          prompt: apiPrompt,
          userId: options?.userId,
          sessionId: get().sessionId ?? undefined,
          projectId: options?.projectId,
          audioUri: options?.audioUri,
          audioDurationSeconds: options?.audioDurationSeconds,
          paymentTxHash: options?.paymentTxHash,
          walletAddress: options?.walletAddress,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        setDirectorFailure(set, await readDirectorError(response))
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

  resumeSession: (sessionId) => {
    const trimmed = sessionId.trim()
    if (!trimmed) return
    set({
      sessionId: trimmed,
      lastError: null,
    })
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
    })
  },
}))
