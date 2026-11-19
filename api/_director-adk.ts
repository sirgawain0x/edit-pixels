/**
 * Creative Director ADK api_server (Cloud Run) client.
 * Converts unary `/run` JSON event arrays into SSE for the Pixels UI.
 */

import { getCloudRunIdToken } from './_vertex-auth.js'

const DEFAULT_ADK_APP_NAME = 'agent'

export function getDirectorAdkBaseUrl(): string | null {
  const raw = process.env.DIRECTOR_ADK_BASE_URL?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}

export function getDirectorAdkAppName(): string {
  return process.env.DIRECTOR_ADK_APP_NAME?.trim() || DEFAULT_ADK_APP_NAME
}

export function encodeAdkEventsAsSse(events: unknown[]): Uint8Array {
  const lines = events.map((event) => `data: ${JSON.stringify(event)}\n\n`)
  return new TextEncoder().encode(lines.join(''))
}

function sessionUrl(baseUrl: string, appName: string, userId: string, sessionId: string): string {
  return `${baseUrl}/apps/${encodeURIComponent(appName)}/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`
}

async function adkJsonAuthHeaders(baseUrl: string): Promise<Record<string, string>> {
  const token = await getCloudRunIdToken(baseUrl)
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

async function ensureAdkDirectorSession(
  baseUrl: string,
  appName: string,
  userId: string,
  sessionId: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(sessionUrl(baseUrl, appName, userId, sessionId), {
    method: 'POST',
    headers,
    body: JSON.stringify({ state: {} }),
    signal,
  })
  if (!response.ok) {
    // Session POST is create-only; an existing id is 409 (older ADK servers used 400).
    if (response.status === 409 || response.status === 400) {
      return
    }
    const detail = await response.text().catch(() => '')
    throw new DirectorAdkError('session', response.status, detail)
  }
}

export interface AdkRunParams {
  baseUrl: string
  appName: string
  userId: string
  sessionId: string
  message: string
  signal?: AbortSignal
}

export class DirectorAdkError extends Error {
  readonly stage: 'session' | 'run'
  readonly status: number
  readonly detail: string

  constructor(stage: 'session' | 'run', status: number, detail: string) {
    super(`Director ADK ${stage} failed (${status})`)
    this.stage = stage
    this.status = status
    this.detail = detail
  }
}

export async function runAdkDirector(params: AdkRunParams): Promise<unknown[]> {
  const { baseUrl, appName, userId, sessionId, message, signal } = params
  const headers = await adkJsonAuthHeaders(baseUrl)
  await ensureAdkDirectorSession(baseUrl, appName, userId, sessionId, headers, signal)

  const response = await fetch(`${baseUrl}/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      appName,
      userId,
      sessionId,
      newMessage: {
        role: 'user',
        parts: [{ text: message }],
      },
    }),
    signal,
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new DirectorAdkError('run', response.status, detail)
  }

  const payload = (await response.json()) as unknown
  if (!Array.isArray(payload)) {
    return [payload]
  }
  return payload
}

function readAdkSessionIdFromEvent(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const record = raw as Record<string, unknown>
  if (typeof record.sessionId === 'string' && record.sessionId.length > 0) {
    return record.sessionId
  }
  if (typeof record.session_id === 'string' && record.session_id.length > 0) {
    return record.session_id
  }
  return ''
}

export function adkEventsIncludeSessionId(events: unknown[]): boolean {
  return events.some((raw) => readAdkSessionIdFromEvent(raw).length > 0)
}

export function withAdkSessionEvent(events: unknown[], sessionId: string): unknown[] {
  if (adkEventsIncludeSessionId(events)) return events
  return [{ sessionId, session_id: sessionId }, ...events]
}

interface AdkEventInspection {
  hasOutput: boolean
  errorMessage: string | null
}

const EMPTY_ADK_INSPECTION: AdkEventInspection = { hasOutput: false, errorMessage: null }

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readAdkErrorMessage(record: Record<string, unknown>): string | null {
  const topMessage = nonEmptyString(record.errorMessage) ?? nonEmptyString(record.error)
  if (topMessage) return topMessage
  if (!record.error || typeof record.error !== 'object') return null
  return nonEmptyString((record.error as { message?: unknown }).message)
}

function hasNonEmptyName(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return nonEmptyString((value as { name?: unknown }).name) !== null
}

function adkPartHasOutput(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false
  const candidate = part as { text?: unknown; functionCall?: unknown; functionResponse?: unknown }
  if (nonEmptyString(candidate.text) !== null) return true
  return hasNonEmptyName(candidate.functionCall) || hasNonEmptyName(candidate.functionResponse)
}

function adkPartsHaveOutput(content: unknown): boolean {
  if (!content || typeof content !== 'object') return false
  const parts = (content as { parts?: unknown }).parts
  return Array.isArray(parts) && parts.some(adkPartHasOutput)
}

function inspectAdkStringEvent(raw: string, depth: number): AdkEventInspection {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '[DONE]') return EMPTY_ADK_INSPECTION
  try {
    return inspectAdkEvent(JSON.parse(trimmed) as unknown, depth + 1)
  } catch {
    return { hasOutput: true, errorMessage: null }
  }
}

function inspectAdkEvent(raw: unknown, depth = 0): AdkEventInspection {
  if (depth > 4 || raw == null) return EMPTY_ADK_INSPECTION
  if (typeof raw === 'string') return inspectAdkStringEvent(raw, depth)
  if (typeof raw !== 'object') return { hasOutput: true, errorMessage: null }

  const record = raw as Record<string, unknown>
  const errorMessage = readAdkErrorMessage(record)
  const hasOutput = adkPartsHaveOutput(record.content)
  if (!hasOutput && !errorMessage && record.event != null) {
    return inspectAdkEvent(record.event, depth + 1)
  }
  return { hasOutput, errorMessage }
}

/** Return an error message when ADK `/run` produced no output and failed or returned empty. */
export function extractAdkRunFailure(events: unknown[]): string | null {
  if (events.length === 0) return 'Empty response from Director ADK'
  let firstError: string | null = null
  for (const event of events) {
    const inspected = inspectAdkEvent(event)
    if (inspected.hasOutput) return null
    if (!firstError && inspected.errorMessage) {
      firstError = inspected.errorMessage
    }
  }
  return firstError
}
