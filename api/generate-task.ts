/**
 * GET /api/generate-task?id=...
 * Poll Evolink task status. Requires Privy auth; task must be owned by the wallet.
 */

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { evolinkServerGet, isEvolinkServerConfigured } from './_evolink-server.js'
import { getGenerativeTaskOwner } from './_task-registry.js'

export async function GET(request: Request): Promise<Response> {
  if (!isEvolinkServerConfigured()) {
    return Response.json({ error: 'service unavailable' }, { status: 503 })
  }

  const token = getBearerToken(request)
  if (!token) {
    return Response.json({ error: 'missing authorization' }, { status: 401 })
  }

  const url = new URL(request.url)
  const taskId = url.searchParams.get('id')?.trim()
  const walletHint = url.searchParams.get('wallet')?.trim()
  if (!taskId) {
    return Response.json({ error: 'id required' }, { status: 400 })
  }

  const auth = await verifyPrivyAccessToken(token, walletHint)
  if (!auth) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 })
  }

  const owner = await getGenerativeTaskOwner(taskId)
  if (!owner) {
    return Response.json({ error: 'task not found' }, { status: 404 })
  }
  if (owner !== auth.address.toLowerCase()) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  try {
    const result = await evolinkServerGet<Record<string, unknown>>(`/tasks/${taskId}`)
    return Response.json(result)
  } catch (e) {
    console.error('generate-task error', e)
    return Response.json({ error: 'poll failed' }, { status: 502 })
  }
}
