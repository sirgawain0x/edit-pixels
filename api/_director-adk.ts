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
