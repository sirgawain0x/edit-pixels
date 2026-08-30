/**
 * GET /api/generate-task?id=...
 * Poll Vertex Veo operation status. Requires Privy auth; task must be owned by the wallet.
 */
// fallow-ignore-file complexity

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { toGenerativeTaskDetail } from './_generative-task-response.js'
import { isVertexGenerativeConfigured, pollVeoOperation } from './_vertex-generative.js'
import { getGenerativeTaskMeta, getGenerativeTaskOwner } from './_task-registry.js'

export async function GET(request: Request): Promise<Response> {
  if (!isVertexGenerativeConfigured()) {
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

  const meta = await getGenerativeTaskMeta(taskId)
  if (!meta) {
    return Response.json({ error: 'task metadata not found' }, { status: 404 })
  }

  try {
    const poll = await pollVeoOperation(meta.operationName, meta.modelId)
    const detail = toGenerativeTaskDetail(taskId, meta.modelId, poll)
    return Response.json(detail)
  } catch (e) {
    console.error('generate-task error', e)
    return Response.json({ error: 'poll failed' }, { status: 502 })
  }
}
