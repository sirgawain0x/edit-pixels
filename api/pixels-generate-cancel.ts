/**
 * POST /api/pixels-generate-cancel — best-effort payment release when client aborts
 * after paying but before delivery.
 */
// fallow-ignore-file complexity,code-duplication

import { authenticateGenerativePost } from './_pixels-generate-route-auth.js'
import { isSeedanceGenerateEnabled } from './_seedance-pricing.js'
import { getPixelsGenerateJob } from './_pixels-generate-jobs.js'
import { canCancelPixelsGenerateJob, cancelPixelsGenerateJob } from './_pixels-generate-payment.js'

export async function POST(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }

  const authenticated = await authenticateGenerativePost(request)
  if (!authenticated.ok) return authenticated.response
  const { signer, body } = authenticated

  const requestId =
    typeof body.requestId === 'string' && body.requestId.trim().length > 0
      ? body.requestId.trim()
      : null
  if (!requestId) {
    return Response.json({ error: 'requestId required' }, { status: 400 })
  }

  const job = await getPixelsGenerateJob(requestId)
  if (!job) {
    return Response.json({ error: 'task not found' }, { status: 404 })
  }
  if (job.wallet !== signer.toLowerCase()) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  if (job.status === 'completed' && job.output?.video_url) {
    return Response.json({ error: 'already_delivered' }, { status: 409 })
  }

  if (!canCancelPixelsGenerateJob(job)) {
    return Response.json({
      id: requestId,
      status: job.status,
      paymentReleased: job.paymentReleased ?? false,
    })
  }

  await cancelPixelsGenerateJob(requestId)

  const finalJob = await getPixelsGenerateJob(requestId)
  return Response.json({
    id: requestId,
    status: finalJob?.status ?? 'cancelled',
    paymentReleased: finalJob?.paymentReleased ?? false,
  })
}
