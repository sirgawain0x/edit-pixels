/// <reference types="node" />
/**
 * Director session history (Firestore REST), Privy-authorized per wallet.
 *
 *   GET    /api/director-sessions?wallet=0x...&projectId=...      → { sessions }
 *   GET    /api/director-sessions?wallet=0x...&sessionId=...      → { transcript }
 *   DELETE /api/director-sessions?wallet=0x...&sessionId=...      → { deleted: true }
 *
 * Firestore REST calls use an 8s timeout so a WIF/Firestore hang returns quickly
 * instead of burning Vercel `maxDuration` (30s) and surfacing as 504.
 */
// fallow-ignore-file complexity

import {
  authorizeDirectorSessionsGet,
  normalizeDirectorSessionsWallet,
} from './_director-sessions-auth.js'
import {
  deleteDirectorSession,
  getDirectorSessionTranscript,
  listDirectorSessions,
} from './_director-firestore.js'
import { isDirectorFirestoreEnabled } from './_firestore-client.js'
import { isServiceAccountImpersonationDenied, vertexAuthFailureMessage } from './_vertex-auth.js'
import { rateLimitByClientIp, rateLimitByIdentity } from './_rate-limit.js'

const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/

type AuthorizedRequest =
  | { ok: true; url: URL; walletAddress: string }
  | { ok: false; response: Response }

async function authorize(request: Request): Promise<AuthorizedRequest> {
  const ipLimited = await rateLimitByClientIp(request, 'director')
  if (ipLimited) return { ok: false, response: ipLimited }

  const url = new URL(request.url)
  const walletRaw = url.searchParams.get('wallet')?.trim()
  const walletAddress = walletRaw ? normalizeDirectorSessionsWallet(walletRaw) : null
  if (!walletAddress) {
    return {
      ok: false,
      response: Response.json({ error: 'wallet query param required' }, { status: 400 }),
    }
  }

  const auth = await authorizeDirectorSessionsGet(request, walletAddress)
  if (!auth.ok) return auth

  const identityLimited = await rateLimitByIdentity(request, 'director', auth.verifiedSigner)
  if (identityLimited) return { ok: false, response: identityLimited }

  return { ok: true, url, walletAddress }
}

function readSessionId(url: URL): string | null {
  const raw = url.searchParams.get('sessionId')?.trim()
  return raw && SESSION_ID_PATTERN.test(raw) ? raw : null
}

function firestoreFailure(error: unknown, label: string, extra: Record<string, unknown> = {}) {
  console.error(`Director sessions ${label} failed`, error)
  if (isServiceAccountImpersonationDenied(error)) {
    return Response.json(
      { error: `Director auth failed: ${vertexAuthFailureMessage(error)}`, ...extra },
      { status: 503 },
    )
  }
  return null
}

export async function GET(request: Request): Promise<Response> {
  const authorized = await authorize(request)
  if (!authorized.ok) return authorized.response
  const { url, walletAddress } = authorized

  if (url.searchParams.has('sessionId')) {
    const sessionId = readSessionId(url)
    if (!sessionId) {
      return Response.json({ error: 'invalid sessionId' }, { status: 400 })
    }
    if (!isDirectorFirestoreEnabled()) {
      return Response.json({ error: 'session history unavailable' }, { status: 404 })
    }
    try {
      const transcript = await getDirectorSessionTranscript({ walletAddress, sessionId })
      if (!transcript) {
        return Response.json({ error: 'session not found' }, { status: 404 })
      }
      return Response.json({ transcript })
    } catch (error) {
      return (
        firestoreFailure(error, 'transcript') ??
        Response.json({ error: 'could not load session' }, { status: 502 })
      )
    }
  }

  if (!isDirectorFirestoreEnabled()) {
    return Response.json({ sessions: [] })
  }

  const projectId = url.searchParams.get('projectId')?.trim() || undefined
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined

  try {
    const sessions = await listDirectorSessions({
      walletAddress,
      projectId,
      limit: Number.isFinite(limit) ? limit : undefined,
    })
    return Response.json({ sessions })
  } catch (error) {
    return firestoreFailure(error, 'list', { sessions: [] }) ?? Response.json({ sessions: [] })
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const authorized = await authorize(request)
  if (!authorized.ok) return authorized.response
  const { url, walletAddress } = authorized

  const sessionId = readSessionId(url)
  if (!sessionId) {
    return Response.json({ error: 'sessionId required' }, { status: 400 })
  }
  if (!isDirectorFirestoreEnabled()) {
    return Response.json({ error: 'session history unavailable' }, { status: 404 })
  }

  try {
    const result = await deleteDirectorSession({ walletAddress, sessionId })
    if (result === 'not_found') {
      return Response.json({ error: 'session not found' }, { status: 404 })
    }
    if (result === 'failed') {
      return Response.json({ error: 'could not fully delete session' }, { status: 502 })
    }
    return Response.json({ deleted: true })
  } catch (error) {
    return (
      firestoreFailure(error, 'delete') ??
      Response.json({ error: 'could not delete session' }, { status: 502 })
    )
  }
}
