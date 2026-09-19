/**
 * POST /api/pixels-generate-cancel — best-effort payment release when client aborts
 * after paying but before delivery.
 */
// fallow-ignore-file complexity,code-duplication

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { isSeedanceGenerateEnabled } from './_seedance-pricing.js'
import { getPixelsGenerateJob } from './_pixels-generate-jobs.js'
import {
  canCancelPixelsGenerateJob,
  cancelPixelsGenerateJob,
} from './_pixels-generate-payment.js'

export async function POST(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return Response.json({ error: 'invalid body' }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const token = getBearerToken(request) || (typeof body.token === 'string' ? body.token : null)
  if (!token) {
    return Response.json({ error: 'missing authorization' }, { status: 401 })
  }

  const auth = await verifyPrivyAccessToken(
    token,
    typeof body.walletAddress === 'string' ? body.walletAddress : undefined,
  )
  if (!auth) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 })
  }

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
  if (job.wallet !== auth.address.toLowerCase()) {
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
