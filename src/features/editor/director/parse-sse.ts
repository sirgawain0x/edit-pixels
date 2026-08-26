/**
 * Parse Vertex Agent Engine / ADK SSE payloads into UI-friendly events.
 */

export type DirectorStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; args?: Record<string, unknown> }
  | { type: 'tool-result'; name: string; result?: unknown }
  | { type: 'error'; message: string }
  | { type: 'session'; sessionId: string }

interface AdkPart {
  text?: string
  functionCall?: { name?: string; args?: Record<string, unknown> }
  functionResponse?: { name?: string; response?: unknown }
}

interface AdkEventLike {
  content?: { parts?: AdkPart[] }
  error?: string | { message?: string }
  errorMessage?: string
  session_id?: string
  sessionId?: string
}

/** Extract complete `data:` payloads from an SSE chunk buffer; returns leftover. */
export function consumeSseBuffer(buffer: string): { events: string[]; rest: string } {
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

function mapStringEvent(raw: string): DirectorStreamEvent[] {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '[DONE]') return []
  try {
    return mapAdkEvent(JSON.parse(trimmed) as unknown)
  } catch {
    return [{ type: 'text', text: trimmed }]
  }
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

function mapContentParts(parts: AdkPart[]): DirectorStreamEvent[] {
  const out: DirectorStreamEvent[] = []
  for (const part of parts) {
    if (typeof part.text === 'string' && part.text.length > 0) {
      out.push({ type: 'text', text: part.text })
    }
    if (part.functionCall?.name) {
      out.push({
        type: 'tool',
        name: part.functionCall.name,
        args: asRecord(part.functionCall.args),
      })
    }
    if (part.functionResponse?.name) {
      out.push({
        type: 'tool-result',
        name: part.functionResponse.name,
        result: part.functionResponse.response,
      })
    }
  }
  return out
}

/** Map one ADK / Agent Engine JSON event into zero or more stream events. */
export function mapAdkEvent(raw: unknown): DirectorStreamEvent[] {
  if (raw == null) return []
  if (typeof raw === 'string') return mapStringEvent(raw)
  if (typeof raw !== 'object') return [{ type: 'text', text: String(raw) }]

  const event = raw as AdkEventLike
  const out: DirectorStreamEvent[] = []
  const sessionId = readSessionId(event)
  const errorMessage = readErrorMessage(event)

  if (sessionId) out.push({ type: 'session', sessionId })
  if (errorMessage) out.push({ type: 'error', message: errorMessage })

  const parts = event.content?.parts
  if (Array.isArray(parts)) {
    out.push(...mapContentParts(parts))
  }

  const nested = asRecord(raw)?.['event']
  if (nested && out.length === (sessionId ? 1 : 0) && !errorMessage) {
    out.push(...mapAdkEvent(nested))
  }

  return out
}

export function parseSseDataLine(data: string): DirectorStreamEvent[] {
  return mapAdkEvent(data)
}
