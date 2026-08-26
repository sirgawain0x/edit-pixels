/**
 * UI store for Creative Director (Vertex Agent Engine SSE).
 * Display-only — does not mutate the timeline.
 */

import { create } from 'zustand'
import { consumeSseBuffer, parseSseDataLine, type DirectorStreamEvent } from './parse-sse'

export type DirectorPhase = 'idle' | 'streaming'

export interface DirectorChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'error'
  content: string
  toolName?: string
}

export interface DirectorToolCall {
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

  submit: (text: string, options?: { audioUri?: string; userId?: string }) => Promise<void>
  cancel: () => void
  clearChat: () => void
}

let activeController: AbortController | null = null

function newId(): string {
  return crypto.randomUUID()
}

function applyStreamEvents(
  events: DirectorStreamEvent[],
  set: (
    partial: Partial<DirectorState> | ((state: DirectorState) => Partial<DirectorState>),
  ) => void,
): void {
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

export const useDirectorStore = create<DirectorState>((set, get) => ({
  messages: [],
  phase: 'idle',
  streamingText: '',
  toolCalls: [],
  sessionId: null,
  lastError: null,

  submit: async (text, options) => {
    const trimmed = text.trim()
    if (!trimmed || get().phase !== 'idle') return

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
          prompt: trimmed,
          userId: options?.userId,
          sessionId: get().sessionId ?? undefined,
          audioUri: options?.audioUri,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        let message = `Director request failed (${response.status})`
        try {
          const data = (await response.json()) as { error?: string }
          if (data.error) message = data.error
        } catch {
          // ignore body parse errors
        }
        set((state) => ({
          messages: [...state.messages, { id: newId(), role: 'error', content: message }],
          phase: 'idle',
          streamingText: '',
          lastError: message,
        }))
        return
      }

      if (!response.body) {
        set((state) => ({
          messages: [
            ...state.messages,
            { id: newId(), role: 'error', content: 'Empty response from Director' },
          ],
          phase: 'idle',
          lastError: 'Empty response from Director',
        }))
        return
      }

      const reader = response.body.getReader()
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

      const streamed = get().streamingText.trim()
      set((state) => ({
        messages: streamed
          ? [...state.messages, { id: newId(), role: 'assistant', content: streamed }]
          : state.messages,
        streamingText: '',
        phase: 'idle',
      }))
    } catch (error) {
      if (controller.signal.aborted) {
        const streamed = get().streamingText.trim()
        set((state) => ({
          messages: streamed
            ? [...state.messages, { id: newId(), role: 'assistant', content: streamed }]
            : state.messages,
          streamingText: '',
          phase: 'idle',
        }))
      } else {
        const message = error instanceof Error ? error.message : 'Something went wrong.'
        set((state) => ({
          messages: [...state.messages, { id: newId(), role: 'error', content: message }],
          streamingText: '',
          phase: 'idle',
          lastError: message,
        }))
      }
    } finally {
      activeController = null
    }
  },

  cancel: () => {
    activeController?.abort()
    activeController = null
    const streamed = get().streamingText.trim()
    set((state) => ({
      messages: streamed
        ? [...state.messages, { id: newId(), role: 'assistant', content: streamed }]
        : state.messages,
      phase: 'idle',
      streamingText: '',
    }))
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
