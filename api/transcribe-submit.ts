/**
 * POST /api/transcribe-submit
 *
 * Verifies the CRTVAI payment against the quote pinned on the job, then hands the
 * batch to Google Speech. Never trusts a client-supplied `gs://` URI: every file
 * must live under this job's own input prefix, because BatchRecognize will happily
 * transcribe (and bill us for) any object we can read.
 *
 * Payment order matters. The tx is consumed first — the ledger is the only place
 * that can stop the same hash being spent twice — and released again if Google
 * rejects the batch, so a failed submit does not eat the user's payment.
 */
import { releaseFlowPayment } from './flow-billing.js'
import {
  authenticateGenerativePost,
  verifyGenerativeCrtvaiPayment,
} from './_pixels-generate-route-auth.js'
import { submitTranscriptionBatch, type BatchInputFile } from './_transcribe-batch.js'
import { isOwnedInputUri } from './_transcribe-uris.js'
import { readTranscriptionJob, recordBatchSubmission } from './_transcription-jobs.js'

/** 480 source minutes at the 20-minute sub-file wall is 24 files; anything past that is a lie. */
const MAX_BATCH_FILES = 32

interface SubmitRequest {
  jobId: string
  paymentTxHash: string
  files: BatchInputFile[]
  languageCode?: string
}

/** The pinned minimum is stored as a decimal string; the verifier wants wei. */
function minWeiOf(value: string | null): bigint | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null
  return BigInt(value.trim())
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** One file entry, or null when it has no usable uri. */
function parseFile(raw: unknown): BatchInputFile | null {
  const file = (raw ?? {}) as { uri?: unknown; languageCode?: unknown }
  const uri = nonEmptyString(file.uri)
  if (!uri) return null
  const languageCode = nonEmptyString(file.languageCode)
  return { uri, ...(languageCode ? { languageCode } : {}) }
}

function parseSubmitRequest(body: Record<string, unknown>): SubmitRequest | null {
  const jobId = nonEmptyString(body.jobId)?.trim()
  const paymentTxHash = nonEmptyString(body.paymentTxHash)?.trim()
  const rawFiles = Array.isArray(body.files) ? body.files : []
  if (!jobId || !paymentTxHash) return null
  if (rawFiles.length === 0 || rawFiles.length > MAX_BATCH_FILES) return null

  const files: BatchInputFile[] = []
  for (const raw of rawFiles) {
    const file = parseFile(raw)
    if (!file) return null
    files.push(file)
  }

  const languageCode = nonEmptyString(body.languageCode)
  return { jobId, paymentTxHash, files, ...(languageCode ? { languageCode } : {}) }
}

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authenticateGenerativePost(request)
  if (!authenticated.ok) return authenticated.response
  const { body, signer, payer } = authenticated

  const req = parseSubmitRequest(body)
  if (!req) return Response.json({ error: 'invalid request' }, { status: 400 })

  const accountId = signer.toLowerCase()
  const job = await readTranscriptionJob(req.jobId)
  // Another account's job reads as missing, so ids cannot be probed for existence.
  if (!job || job.accountId !== accountId) {
    return Response.json({ error: 'job not found' }, { status: 404 })
  }

  // Idempotent: a job already at Google must not be submitted (and billed) twice.
  if (job.operationName && (job.status === 'running' || job.status === 'retrying')) {
    return Response.json({
      jobId: req.jobId,
      operationName: job.operationName,
      alreadySubmitted: true,
    })
  }
  if (job.status !== 'quoted') {
    return Response.json({ error: 'job_not_submittable', status: job.status }, { status: 409 })
  }
  const minCrtvaiWei = minWeiOf(job.minCrtvaiWei)
  if (minCrtvaiWei === null) {
    // A job with no pinned minimum cannot be paid for; that is a lost quote, not a bad request.
    return Response.json({ error: 'quote_missing' }, { status: 409 })
  }

  const foreign = req.files.filter(
    (file) => !isOwnedInputUri(file.uri, { accountId, jobId: req.jobId }),
  )
  if (foreign.length > 0) {
    return Response.json(
      { error: 'file_not_owned_by_job', files: foreign.map((file) => file.uri) },
      { status: 400 },
    )
  }

  const verified = await verifyGenerativeCrtvaiPayment({
    paymentTxHash: req.paymentTxHash,
    signer,
    payer,
    quote: { minCrtvaiWei },
    purpose: 'transcribe',
  })
  if (!verified.ok) {
    return Response.json(
      { error: 'payment_not_verified', reason: verified.reason },
      { status: 402 },
    )
  }

  try {
    const { operationName } = await submitTranscriptionBatch({
      files: req.files,
      languageCode: req.languageCode,
    })
    const recorded = await recordBatchSubmission({
      jobId: req.jobId,
      operationName,
      txHash: req.paymentTxHash,
      logIndex: verified.logIndex,
      submittedAt: Date.now(),
    })
    if (!recorded) {
      // The batch is running at Google with no local handle to it: reconcile by the
      // operation name in the response, not by the record.
      console.error('transcription_jobs submit record write failed', {
        jobId: req.jobId,
        operationName,
      })
    }
    return Response.json({ jobId: req.jobId, operationName })
  } catch (error) {
    console.error('transcription batch submit failed', error)
    // The payment was already consumed; hand it back so the user can retry.
    await releaseFlowPayment(req.paymentTxHash, verified.logIndex).catch((releaseError) =>
      console.error('transcription payment release failed', {
        jobId: req.jobId,
        txHash: req.paymentTxHash,
        logIndex: verified.logIndex,
        releaseError,
      }),
    )
    return Response.json({ error: 'submit_failed' }, { status: 502 })
  }
}
