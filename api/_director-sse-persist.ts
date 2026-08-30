/**
 * Server-side SSE parsing for Director Firestore persistence.
 * Mirrors the client parser in src/features/editor/director/parse-sse.ts.
 */

export interface DirectorSsePersistState {
  sessionId: string | null
  assistantText: string
  hadError: boolean
}

interface AdkPart {
  text?: string
}

interface AdkEventLike {
  content?: { parts?: AdkPart[] }
  error?: string | { message?: string }
  errorMessage?: string
  session_id?: string
  sessionId?: string
}

export function createDirectorSsePersistState(initialSessionId?: string): DirectorSsePersistState {
  return {
    sessionId: initialSessionId?.trim() || null,
    assistantText: '',
    hadError: false,
  }
}

function consumeSseBuffer(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const rest = parts.pop() ?? ''
  const events: string[] = []

  for (const block of parts) {
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''))
      }
    }
    if (dataLines.length > 0) {
      events.push(dataLines.join('\n'))
    }
  }

  return { events, rest }
}

function readSessionId(event: AdkEventLike): string {
  if (typeof event.session_id === 'string' && event.session_id) return event.session_id
  if (typeof event.sessionId === 'string' && event.sessionId) return event.sessionId
  return ''
}

function readErrorMessage(event: AdkEventLike): string {
  if (typeof event.errorMessage === 'string' && event.errorMessage) return event.errorMessage
  if (typeof event.error === 'string' && event.error) return event.error
  if (
    event.error &&
    typeof event.error === 'object' &&
    typeof event.error.message === 'string' &&
    event.error.message
  ) {
    return event.error.message
  }
  return ''
}

function applyAdkPayload(state: DirectorSsePersistState, raw: unknown): void {
  if (raw == null) return
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed && trimmed !== '[DONE]') {
      try {
        applyAdkPayload(state, JSON.parse(trimmed) as unknown)
      } catch {
        state.assistantText += trimmed
      }
    }
    return
  }
  if (typeof raw !== 'object') {
    state.assistantText += String(raw)
    return
  }

  const event = raw as AdkEventLike
  const sessionId = readSessionId(event)
  if (sessionId) state.sessionId = sessionId

  const errorMessage = readErrorMessage(event)
  if (errorMessage) state.hadError = true

  const parts = event.content?.parts
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (typeof part.text === 'string' && part.text.length > 0) {
        state.assistantText += part.text
      }
    }
  }

  const nested = (raw as Record<string, unknown>)['event']
  if (nested) applyAdkPayload(state, nested)
}

export class DirectorSsePersistAccumulator {
  private buffer = ''
  readonly state: DirectorSsePersistState

  constructor(initialSessionId?: string) {
    this.state = createDirectorSsePersistState(initialSessionId)
  }

  pushChunk(chunk: Uint8Array, decoder: TextDecoder): void {
    this.buffer += decoder.decode(chunk, { stream: true })
    const { events, rest } = consumeSseBuffer(this.buffer)
    this.buffer = rest
    for (const data of events) {
      applyAdkPayload(this.state, data)
    }
  }

  flush(decoder: TextDecoder): void {
    if (this.buffer.length > 0) {
      this.pushChunk(new Uint8Array(), decoder)
    }
    if (this.buffer.trim()) {
      const { events } = consumeSseBuffer(`${this.buffer}\n\n`)
      for (const data of events) {
        applyAdkPayload(this.state, data)
      }
      this.buffer = ''
    }
  }
}

export function extractStoryboardScenes(markdown: string): string[] {
  const trimmed = markdown.trim()
  if (!trimmed) return []

  const sections = trimmed.split(/\n(?=##\s+)/)
  if (sections.length > 1) {
    return sections.map((section) => section.trim()).filter(Boolean)
  }

  const sceneLines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(-|\*)?\s*scene\s+\d+/i.test(line) || /^#{1,3}\s*scene/i.test(line))

  return sceneLines.length > 0 ? sceneLines : []
}
