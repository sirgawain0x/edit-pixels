/**
 * GET /api/transcribe-job?jobId=...
 *
 * Reports a transcription job's state. While the batch is at Google this polls the
 * operation so the client can show real progress; once it finishes it returns the
 * per-file result URIs, which the client fetches and parses.
 *
 * Nothing is written here — a poll must not mutate billing state. `status` is
 * therefore a *projection*: it reads `completed` as soon as Google says so, while
 * the stored row still says `running` until the reconcile step pins the numbers.
 */

import { pollTranscriptionOperation } from './_transcribe-batch.js'
import { authenticateGenerativeGet } from './_pixels-generate-route-auth.js'
import { readTranscriptionJob, type GetTranscriptionJobResponse } from './_transcription-jobs.js'

async function projectRunningJob(job: {
  operationName: string | null
}): Promise<Partial<GetTranscriptionJobResponse>> {
  if (!job.operationName) return {}
  try {
    const operation = await pollTranscriptionOperation(job.operationName)
    if (operation.status === 'completed') {
      return {
        status: 'completed',
        progressPercent: 100,
        files: operation.files,
        totalBilledSeconds: operation.totalBilledSeconds,
      }
    }
    if (operation.status === 'failed') {
      return {
        status: 'failed',
        progressPercent: operation.progressPercent,
        errorMessage: operation.errorMessage ?? 'batch failed',
      }
    }
    return { progressPercent: operation.progressPercent }
  } catch (error) {
    // A poll failure is not a job failure: report it alongside the stored status.
    console.error('transcription operation poll failed', error)
    return { errorMessage: 'operation poll failed' }
  }
}

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

  const base: GetTranscriptionJobResponse = {
    jobId,
    status: job.status,
    reconcileVerdict: job.reconcileVerdict,
  }
  const projected = job.status === 'running' ? await projectRunningJob(job) : {}

  return Response.json({ ...base, ...projected })
}
