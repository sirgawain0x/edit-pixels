/**
 * GET /api/transcribe-job?jobId=...
 *
 * Polls the persisted `transcription_jobs` record and returns status.
 * Never runs reconciliation here — it only reads already-persisted state, so a
 * poll cannot change what a job was billed.
 */

import { authenticateGenerativeGet } from './_pixels-generate-route-auth.js'
import { readTranscriptionJob, type GetTranscriptionJobResponse } from './_transcription-jobs.js'

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')?.trim()

  if (!jobId) {
    return Response.json({ error: 'missing jobId' }, { status: 400 })
  }

  const authenticated = await authenticateGenerativeGet(request)
  if (!authenticated.ok) return authenticated.response
  const accountId = authenticated.signer.toLowerCase()

  const job = await readTranscriptionJob(jobId)
  // Another account's job reads as missing, so ids cannot be probed for existence.
  if (!job || job.accountId !== accountId) {
    return Response.json({ error: 'job not found' }, { status: 404 })
  }

  const response: GetTranscriptionJobResponse = {
    jobId,
    status: job.status,
    reconcileVerdict: job.reconcileVerdict,
  }

  return Response.json(response)
}
