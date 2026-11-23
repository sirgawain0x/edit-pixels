/**
 * The four requests a Precision run makes, as plain functions.
 *
 * Kept apart from the orchestrator so the sequence stays readable and testable: this module
 * knows the wire shapes, `run-precision-job` knows the order. Everything takes `fetchImpl` so
 * a test drives the real code without a server.
 */
import type {
  StartTranscriptionPrecisionRequest,
  StartTranscriptionPrecisionResponse,
} from '../jobs/types'
import type { CloudPart } from '../lib/plan-cloud-parts'
import type { PartResult, PrecisionQuote, LandedPart } from '../lib/run-precision-job'
import {
  uploadParts,
  type UploadPartInput,
  type UploadedPart as UploadedPartBlob,
} from '../lib/upload-parts'

export const QUOTE_PATH = '/api/transcribe-precision'
export const SUBMIT_PATH = '/api/transcribe-submit'
export const PART_PATH = '/api/transcribe-part'

interface ErrorBody {
  error?: unknown
  reason?: unknown
  detail?: unknown
}

/** Turn a non-2xx response into the server's own reason, so the UI can say something true. */
async function failureOf(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as ErrorBody
  const reason = [body.error, body.reason, body.detail].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  )
  return new Error(reason.join(': ') || `Request failed (${response.status})`)
}

async function postJson<T>(
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetchImpl(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) throw await failureOf(response)
  return (await response.json()) as T
}

export interface QuoteRequestInput {
  mediaId: string
  model: StartTranscriptionPrecisionRequest['model']
  glossary?: string
  sourceDurationSec: number
  parts: readonly CloudPart[]
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

/**
 * Ask what the run costs, and pin the answer to a job.
 *
 * `vadSpeechSeconds` is reported as the whole part span: the planner only cuts inside a
 * silence window, so a non-silent second of a part is speech by construction, and the server
 * validates the field but prices on the submitted ceiling. Understating it would be the
 * dishonest direction.
 */
export async function requestPrecisionQuote(input: QuoteRequestInput): Promise<PrecisionQuote> {
  const body: StartTranscriptionPrecisionRequest = {
    mediaId: input.mediaId,
    model: input.model,
    ...(input.glossary ? { glossary: input.glossary } : {}),
    sourceDurationSec: input.sourceDurationSec,
    plan: input.parts.map((part) => ({
      startSec: part.startSec,
      endSec: part.endSec,
      overlapSec: part.overlapSec,
      forcedCut: part.forcedCut,
      vadSpeechSeconds: part.endSec - part.startSec,
    })),
  }

  const response = await postJson<StartTranscriptionPrecisionResponse>(
    QUOTE_PATH,
    body,
    input.fetchImpl ?? fetch,
    input.signal,
  )

  return {
    jobId: response.jobId,
    free: response.free,
    priceUsd: (response.quote?.estimatedUsdc6 ?? 0) / 1_000_000,
    // A free run has nothing to pay, so the floor is zero rather than absent.
    minCrtvaiWei: response.quote?.minCrtvaiWei ?? '0',
  }
}

/** Send the parts into the job's prefix; the server stats every one before money moves. */
export async function uploadPrecisionParts(input: {
  jobId: string
  parts: readonly CloudPart[]
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<LandedPart[]> {
  const uploads: UploadPartInput[] = input.parts.map((part) => ({
    name: part.name,
    contentType: part.contentType,
    blob: part.blob,
  }))

  const landed: UploadedPartBlob[] = await uploadParts({
    jobId: input.jobId,
    parts: uploads,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  })

  // The planner indexes its parts; the upload lib names them. Both are the same order, and the
  // orchestrator needs the index to pair a file with its span.
  return landed.map((file, index) => ({ index, uri: file.uri }))
}

/** Pin the payment on the job. This is the point past which the run may spend. */
export async function submitPrecisionJob(input: {
  jobId: string
  txHash: string | null
  files: readonly LandedPart[]
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<void> {
  await postJson<unknown>(
    SUBMIT_PATH,
    {
      jobId: input.jobId,
      ...(input.txHash ? { paymentTxHash: input.txHash } : {}),
      files: input.files.map((file) => ({ uri: file.uri })),
    },
    input.fetchImpl ?? fetch,
    input.signal,
  )
}

/** Transcribe one part. The response carries part-relative offsets; the merge adds the start. */
export async function requestTranscriptionPart(input: {
  jobId: string
  partIndex: number
  uri: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<PartResult> {
  const body = await postJson<{ segments?: PartResult['segments'] }>(
    PART_PATH,
    { jobId: input.jobId, partIndex: input.partIndex, uri: input.uri },
    input.fetchImpl ?? fetch,
    input.signal,
  )
  return { segments: body.segments ?? [] }
}
