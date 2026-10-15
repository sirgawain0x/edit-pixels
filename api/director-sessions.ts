/// <reference types="node" />
/**
 * GET /api/director-sessions?wallet=0x...&projectId=...
 * Lists persisted Director session metadata from Firestore REST.
 *
 * List uses an 8s REST timeout so a WIF/Firestore hang returns `[]` instead of
 * burning Vercel `maxDuration` (30s) and surfacing as 504.
 */
// fallow-ignore-file complexity

import {
  authorizeDirectorSessionsGet,
  normalizeDirectorSessionsWallet,
} from './_director-sessions-auth.js'
import { listDirectorSessions } from './_director-firestore.js'
import { isDirectorFirestoreEnabled } from './_firestore-client.js'
import {
  isServiceAccountImpersonationDenied,
  vertexAuthFailureMessage,
} from './_vertex-auth.js'
import { rateLimitByClientIp, rateLimitByIdentity } from './_rate-limit.js'

export async function GET(request: Request): Promise<Response> {
  const ipLimited = await rateLimitByClientIp(request, 'director')
  if (ipLimited) return ipLimited

  const url = new URL(request.url)
  const walletRaw = url.searchParams.get('wallet')?.trim()
  const walletAddress = walletRaw ? normalizeDirectorSessionsWallet(walletRaw) : null
  if (!walletAddress) {
    return Response.json({ error: 'wallet query param required' }, { status: 400 })
  }

  const auth = await authorizeDirectorSessionsGet(request, walletAddress)
  if (!auth.ok) return auth.response

  const identityLimited = await rateLimitByIdentity(request, 'director', auth.verifiedSigner)
  if (identityLimited) return identityLimited

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
    console.error('Director sessions list failed', error)
    if (isServiceAccountImpersonationDenied(error)) {
      return Response.json(
        { error: `Director auth failed: ${vertexAuthFailureMessage(error)}`, sessions: [] },
        { status: 503 },
      )
    }
    return Response.json({ sessions: [] })
  }
}
