/**
 * POST /api/transcribe-submit
 *
 * Verifies the CRTVAI payment against the quote pinned on the job, then hands the
 * batch to Google Speech. Never trusts a client-supplied `gs://` URI: every file
 * must live under this job's own input prefix, because BatchRecognize will happily
 * transcribe (and bill us for) any object we can read.
 *
 * A free run has no payment to verify — its monthly allowance is the payment — so it
 * is submitted directly. If Google then refuses the batch the two cases unwind
 * differently: a paid run hands its tx back to the ledger, and a free run hands its
 * credit back to the allowance.
 */
import { releaseFlowPayment } from './flow-billing.js'
import {
  authenticateGenerativePost,
  verifyGenerativeCrtvaiPayment,
} from './_pixels-generate-route-auth.js'
import { submitTranscriptionBatch, type BatchInputFile } from './_transcribe-batch.js'
import { isOwnedInputUri } from './_transcribe-uris.js'
import {
  readTranscriptionJob,
  recordBatchSubmission,
  refundFreeRun,
  type TranscriptionJobSummary,
} from './_transcription-jobs.js'

/** 480 source minutes at the 20-minute sub-file wall is 24 files; anything past that is a lie. */
const MAX_BATCH_FILES = 32

interface SubmitRequest {
  jobId: string
  /** Absent for a free run: the monthly allowance is the payment. */
  paymentTxHash?: string
  files: BatchInputFile[]
  languageCode?: string
}

type PaymentCheck =
  | { ok: true; txHash: string | null; logIndex: number | null }
  | {
      ok: false
      response: Response
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

function parseFiles(rawFiles: unknown[]): BatchInputFile[] | null {
  const files: BatchInputFile[] = []
  for (const raw of rawFiles) {
    const file = parseFile(raw)
    if (!file) return null
    files.push(file)
  }
  return files
}

function parseSubmitRequest(body: Record<string, unknown>): SubmitRequest | null {
  const jobId = nonEmptyString(body.jobId)?.trim()
  const rawFiles = Array.isArray(body.files) ? body.files : []
  if (!jobId) return null
  if (rawFiles.length === 0 || rawFiles.length > MAX_BATCH_FILES) return null

  const files = parseFiles(rawFiles)
  if (files === null) return null

  const paymentTxHash = nonEmptyString(body.paymentTxHash)?.trim()
  const languageCode = nonEmptyString(body.languageCode)
  return {
    jobId,
    files,
    ...(paymentTxHash ? { paymentTxHash } : {}),
    ...(languageCode ? { languageCode } : {}),
  }
}

function alreadySubmittedResponse(job: TranscriptionJobSummary, jobId: string): Response | null {
  if (!job.operationName) return null
  if (job.status !== 'running' && job.status !== 'retrying') return null
  return Response.json({ jobId, operationName: job.operationName, alreadySubmitted: true })
}

function notSubmittableResponse(job: TranscriptionJobSummary): Response | null {
  if (job.status === 'quoted') return null
  return Response.json({ error: 'job_not_submittable', status: job.status }, { status: 409 })
}

/** Files outside this job's own prefix, which is a hard refusal before any money moves. */
function foreignFiles(files: BatchInputFile[], accountId: string, jobId: string): string[] {
  return files
    .filter((file) => !isOwnedInputUri(file.uri, { accountId, jobId }))
    .map((file) => file.uri)
}

async function verifySubmitPayment(input: {
  minCrtvaiWei: string | null
  paymentTxHash: string | undefined
  signer: `0x${string}`
  payer: string
}): Promise<PaymentCheck> {
  const minWei = minWeiOf(input.minCrtvaiWei)
  if (minWei === null) {
    // No pinned minimum means the quote was lost; that is not a bad request.
    return { ok: false, response: Response.json({ error: 'quote_missing' }, { status: 409 }) }
  }
  if (!input.paymentTxHash) {
    return { ok: false, response: Response.json({ error: 'payment_required' }, { status: 400 }) }
  }

  const verified = await verifyGenerativeCrtvaiPayment({
    paymentTxHash: input.paymentTxHash,
    signer: input.signer,
    payer: input.payer,
    quote: { minCrtvaiWei: minWei },
    purpose: 'transcribe',
  })
  if (!verified.ok) {
    return {
      ok: false,
      response: Response.json(
        { error: 'payment_not_verified', reason: verified.reason },
        { status: 402 },
      ),
    }
  }
  return { ok: true, txHash: input.paymentTxHash, logIndex: verified.logIndex }
}

/**
 * Undo whatever the user spent when Google refused the batch.
 *
 * A paid run gives the tx back (the ledger consumed it before the call). A free run
 * gives its credit back, so a failed run does not eat one of the five.
 */
async function refundOnFailure(input: {
  freeRun: boolean
  jobId: string
  txHash: string | null
  logIndex: number | null
}): Promise<void> {
  if (input.freeRun) {
    await refundFreeRun(input.jobId).catch((error) =>
      console.error('transcription free run refund failed', { jobId: input.jobId, error }),
    )
    return
  }
  if (!input.txHash || input.logIndex === null) return
  await releaseFlowPayment(input.txHash, input.logIndex).catch((error) =>
    console.error('transcription payment release failed', {
      jobId: input.jobId,
      txHash: input.txHash,
      logIndex: input.logIndex,
      error,
    }),
  )
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
  const alreadySubmitted = alreadySubmittedResponse(job, req.jobId)
  if (alreadySubmitted) return alreadySubmitted
  const notSubmittable = notSubmittableResponse(job)
  if (notSubmittable) return notSubmittable

  const foreign = foreignFiles(req.files, accountId, req.jobId)
  if (foreign.length > 0) {
    return Response.json({ error: 'file_not_owned_by_job', files: foreign }, { status: 400 })
  }

  const freeRun = job.freeRunMonth !== null
  const payment: PaymentCheck = freeRun
    ? { ok: true, txHash: null, logIndex: null }
    : await verifySubmitPayment({
        minCrtvaiWei: job.minCrtvaiWei,
        paymentTxHash: req.paymentTxHash,
        signer,
        payer,
      })
  if (!payment.ok) return payment.response

  try {
    const { operationName } = await submitTranscriptionBatch({
      files: req.files,
      languageCode: req.languageCode,
    })
    const recorded = await recordBatchSubmission({
      jobId: req.jobId,
      operationName,
      txHash: payment.txHash,
      logIndex: payment.logIndex,
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
    return Response.json({ jobId: req.jobId, operationName, free: freeRun })
  } catch (error) {
    console.error('transcription batch submit failed', error)
    await refundOnFailure({
      freeRun,
      jobId: req.jobId,
      txHash: payment.txHash,
      logIndex: payment.logIndex,
    })
    return Response.json({ error: 'submit_failed' }, { status: 502 })
  }
}
