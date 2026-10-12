/**
 * GET /api/pixels-generate-task?id=...
 * Poll Creative Pixels Seedance job status (survives client refresh).
 */
// fallow-ignore-file complexity

import { getPixelsGenerateJob } from './_pixels-generate-jobs.js'
import { isSeedanceGenerateEnabled } from './_seedance-pricing.js'
import { authenticateGenerativeGet } from './_pixels-generate-route-auth.js'

export async function GET(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }

  const url = new URL(request.url)
  const taskId = url.searchParams.get('id')?.trim()
  if (!taskId) {
    return Response.json({ error: 'id required' }, { status: 400 })
  }

  const authenticated = await authenticateGenerativeGet(request)
  if (!authenticated.ok) return authenticated.response
  const { signer } = authenticated

  const job = await getPixelsGenerateJob(taskId)
  if (!job) {
    return Response.json({ error: 'task not found' }, { status: 404 })
  }
  if (job.wallet !== signer.toLowerCase()) {
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
