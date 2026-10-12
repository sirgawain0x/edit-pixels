/**
 * GET /api/generate-task?id=...
 * Poll Vertex Veo operation status. Requires Privy auth; task must be owned by the wallet.
 */
// fallow-ignore-file complexity

import { toGenerativeTaskDetail } from './_generative-task-response.js'
import { isVertexGenerativeConfigured, pollVeoOperation } from './_vertex-generative.js'
import { getGenerativeTaskMeta, getGenerativeTaskOwner } from './_task-registry.js'
import { syncPixelsVeoJobFromPoll } from './_pixels-generate-veo-sync.js'
import { authenticateGenerativeGet } from './_pixels-generate-route-auth.js'

export async function GET(request: Request): Promise<Response> {
  if (!isVertexGenerativeConfigured()) {
    return Response.json({ error: 'service unavailable' }, { status: 503 })
  }

  const url = new URL(request.url)
  const taskId = url.searchParams.get('id')?.trim()
  if (!taskId) {
    return Response.json({ error: 'id required' }, { status: 400 })
  }

  const authenticated = await authenticateGenerativeGet(request)
  if (!authenticated.ok) return authenticated.response
  const { signer } = authenticated

  const owner = await getGenerativeTaskOwner(taskId)
  if (!owner) {
    return Response.json({ error: 'task not found' }, { status: 404 })
  }
  if (owner !== signer.toLowerCase()) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const meta = await getGenerativeTaskMeta(taskId)
  if (!meta) {
    return Response.json({ error: 'task metadata not found' }, { status: 404 })
  }

  try {
    const poll = await pollVeoOperation(meta.operationName, meta.modelId)
    const detail = toGenerativeTaskDetail(taskId, meta.modelId, poll)
    await syncPixelsVeoJobFromPoll(taskId, detail)
    return Response.json(detail)
  } catch (e) {
    console.error('generate-task error', e)
    return Response.json({ error: 'poll failed' }, { status: 502 })
  }
}
