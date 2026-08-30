/// <reference types="node" />
/**
 * GET /api/director-sessions?wallet=0x...&projectId=...
 * Lists persisted Director session metadata from Firestore.
 */

import { assertDirectorAuthorized } from './_director-auth.js'
import { listDirectorSessions } from './_director-firestore.js'
import { isDirectorFirestoreEnabled } from './_firestore-client.js'

export async function GET(request: Request): Promise<Response> {
  const authError = assertDirectorAuthorized(request)
  if (authError) return authError

  if (!isDirectorFirestoreEnabled()) {
    return Response.json({ sessions: [] })
  }

  const url = new URL(request.url)
  const walletAddress = url.searchParams.get('wallet')?.trim()
  if (!walletAddress?.startsWith('0x')) {
    return Response.json({ error: 'wallet query param required' }, { status: 400 })
  }

  const projectId = url.searchParams.get('projectId')?.trim() || undefined
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined

  const sessions = await listDirectorSessions({
    walletAddress,
    projectId,
    limit: Number.isFinite(limit) ? limit : undefined,
  })

  return Response.json({ sessions })
}
