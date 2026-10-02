/// <reference types="node" />
/**
 * Firestore REST client for Director persistence.
 *
 * Avoids `@google-cloud/firestore` (and its native gRPC) so a bad SDK load cannot
 * take down `POST /api/director` with Vercel FUNCTION_INVOCATION_FAILED.
 */
// fallow-ignore-file complexity

import { getVertexAccessToken, getVertexProject } from './_vertex-auth.js'

const DEFAULT_DATABASE_ID = 'creative-director-1'
/** Cap Firestore wait so sessions list cannot burn the full Vercel maxDuration. */
export const FIRESTORE_REST_TIMEOUT_MS = 8_000

export type FirestoreRestValue =
  | { nullValue: null }
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreRestValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreRestValue> } }

export interface FirestoreRestDocument {
  name?: string
  fields?: Record<string, FirestoreRestValue>
  createTime?: string
  updateTime?: string
}

function getFirestoreDatabaseId(): string {
  return process.env.FIRESTORE_DATABASE_ID?.trim() || DEFAULT_DATABASE_ID
}

export function isDirectorFirestoreEnabled(): boolean {
  if (process.env.DIRECTOR_FIRESTORE_DISABLED === '1') return false
  return Boolean(getVertexProject())
}

export function firestoreDocumentsRoot(
  projectId = getVertexProject(),
  databaseId = getFirestoreDatabaseId(),
): string {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`
}

export function encodeFirestoreString(value: string): FirestoreRestValue {
  return { stringValue: value }
}

export function encodeFirestoreNull(): FirestoreRestValue {
  return { nullValue: null }
}

export function encodeFirestoreTimestamp(iso = new Date().toISOString()): FirestoreRestValue {
  return { timestampValue: iso }
}

export function encodeFirestoreStringArray(values: string[]): FirestoreRestValue {
  return {
    arrayValue: {
      values: values.map((value) => encodeFirestoreString(value)),
    },
  }
}

export function encodeFirestoreInteger(value: number): FirestoreRestValue {
  return { integerValue: String(Math.trunc(value)) }
}

export function encodeFirestoreNumber(value: number): FirestoreRestValue {
  if (Number.isInteger(value)) return encodeFirestoreInteger(value)
  return { doubleValue: value }
}

export function readFirestoreString(value: FirestoreRestValue | undefined): string | null {
  if (!value || !('stringValue' in value)) return null
  return value.stringValue
}

export function readFirestoreTimestamp(value: FirestoreRestValue | undefined): string {
  if (!value || !('timestampValue' in value)) return ''
  return value.timestampValue
}

export function documentIdFromName(name: string | undefined): string {
  if (!name) return ''
  const parts = name.split('/')
  return parts[parts.length - 1] || ''
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function firestoreFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? FIRESTORE_REST_TIMEOUT_MS
  const label = `Firestore REST ${init.method || 'GET'} ${path}`
  return withTimeout(
    (async () => {
      const token = await getVertexAccessToken()
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${token}`)
      if (init.body != null && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
      }

      const requestInit: RequestInit = {
        method: init.method,
        headers,
        body: init.body,
        signal: AbortSignal.timeout(timeoutMs),
      }
      return fetch(`${firestoreDocumentsRoot()}${path}`, requestInit)
    })(),
    timeoutMs,
    label,
  )
}

/** PATCH merge-style write for a known document id. */
export async function patchFirestoreDocument(input: {
  collection: string
  documentId: string
  fields: Record<string, FirestoreRestValue>
  timeoutMs?: number
}): Promise<boolean> {
  if (!isDirectorFirestoreEnabled()) return false

  const fieldPaths = Object.keys(input.fields)
  if (fieldPaths.length === 0) return false

  const query = fieldPaths
    .map((path) => `updateMask.fieldPaths=${encodeURIComponent(path)}`)
    .join('&')

  try {
    const response = await firestoreFetch(
      `/${input.collection}/${encodeURIComponent(input.documentId)}?${query}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ fields: input.fields }),
        timeoutMs: input.timeoutMs,
      },
    )
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.error('Director Firestore REST patch failed', response.status, body)
      return false
    }
    return true
  } catch (error) {
    console.error('Director Firestore REST patch failed', error)
    return false
  }
}

/** Create a document with an auto-generated id. */
export async function createFirestoreDocument(input: {
  collection: string
  fields: Record<string, FirestoreRestValue>
  timeoutMs?: number
}): Promise<boolean> {
  if (!isDirectorFirestoreEnabled()) return false

  try {
    const response = await firestoreFetch(`/${input.collection}`, {
      method: 'POST',
      body: JSON.stringify({ fields: input.fields }),
      timeoutMs: input.timeoutMs,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.error('Director Firestore REST create failed', response.status, body)
      return false
    }
    return true
  } catch (error) {
    console.error('Director Firestore REST create failed', error)
    return false
  }
}

export async function runFirestoreStructuredQuery(input: {
  structuredQuery: Record<string, unknown>
  timeoutMs?: number
}): Promise<FirestoreRestDocument[]> {
  if (!isDirectorFirestoreEnabled()) return []

  try {
    const response = await firestoreFetch(':runQuery', {
      method: 'POST',
      body: JSON.stringify({ structuredQuery: input.structuredQuery }),
      timeoutMs: input.timeoutMs,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.error('Director Firestore REST query failed', response.status, body)
      return []
    }

    const rows = (await response.json()) as Array<{ document?: FirestoreRestDocument }>
    if (!Array.isArray(rows)) return []
    return rows.map((row) => row.document).filter((doc): doc is FirestoreRestDocument => Boolean(doc))
  } catch (error) {
    console.error('Director Firestore REST query failed', error)
    return []
  }
}
