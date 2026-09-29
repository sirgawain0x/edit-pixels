/**
 * GET /api/pixels-generate-task?id=...
 * Poll Creative Pixels Seedance job status (survives client refresh).
 */
// fallow-ignore-file complexity

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { getPixelsGenerateJob } from './_pixels-generate-jobs.js'
import { isSeedanceGenerateEnabled } from './_seedance-pricing.js'

export async function GET(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
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

  const job = await getPixelsGenerateJob(taskId)
  if (!job) {
    return Response.json({ error: 'task not found' }, { status: 404 })
  }
  if (job.wallet !== auth.address.toLowerCase()) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  return Response.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    model: job.model,
    veoTaskId: job.veoTaskId,
    output: job.output,
    error: job.error,
    costUsdc6: job.costUsdc6,
    crtvaiRequired: job.crtvaiRequired,
    mock: job.mock,
  })
}
