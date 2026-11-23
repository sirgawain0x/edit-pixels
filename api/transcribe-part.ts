/**
 * POST /api/transcribe-part
 *
 * Transcribe one uploaded part. This is the request that actually spends money at Google,
 * so everything is checked before it is made: the caller owns the job, the job has been
 * paid for, and the file sits inside that job's own `input/` prefix. A `gs://` URI outside
 * the prefix is refused, because the model would happily transcribe anything the service
 * account can read.
 *
 * Why one request per part rather than one per job: the model is unary, and a 20-minute
 * part takes ~40 s at measured throughput. Ten parts in one request would blow any
 * serverless ceiling; ten requests each fit comfortably.
 *
 * Offsets come back relative to the part. The client knows where each part starts and is
 * the only party that does, so the merge step adds the offset rather than the server
 * inventing one.
 */
import { checkPixelsRateLimits } from './_rate-limit.js'
import { authenticateGenerativePost } from './_pixels-generate-route-auth.js'
import { isOwnedInputUri } from './_transcribe-uris.js'
import { readTranscriptionJob } from './_transcription-jobs.js'
import { transcribeFile, type TranscriptionResult } from './_transcribe-gemini.js'

/** 480 source minutes at the 20-minute wall is 24 parts; past that is a lie. */
const MAX_PARTS = 32
/** The documented vocabulary ceiling; beyond it the request is rejected outright. */
const MAX_GLOSSARY_TERMS = 1_000

const MIME_BY_EXTENSION: Record<string, string> = {
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp3': 'audio/mp3',
  '.m4a': 'audio/m4a',
}

interface PartRequest {
  jobId: string
  partIndex: number
  uri: string
}

export interface TranscribePartResponse {
  jobId: string
  partIndex: number
  text: string
  segments: TranscriptionResult['segments']
  usage: TranscriptionResult['usage']
  finishReason: string | null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parseRequest(body: Record<string, unknown>): PartRequest | null {
  const jobId = nonEmptyString(body.jobId)
  const uri = nonEmptyString(body.uri)
  const partIndex = body.partIndex
  if (!jobId || !uri) return null
  if (typeof partIndex !== 'number' || !Number.isInteger(partIndex)) return null
  if (partIndex < 0 || partIndex >= MAX_PARTS) return null
  return { jobId, partIndex, uri }
}

/** Extension of the object key, which is how the client named it when it asked for a session. */
function mimeTypeFor(uri: string): string | null {
  const withoutQuery = uri.split('?')[0] ?? uri
  const dot = withoutQuery.lastIndexOf('.')
  if (dot < 0) return null
  return MIME_BY_EXTENSION[withoutQuery.slice(dot).toLowerCase()] ?? null
}

/** The quote stores the glossary as raw text; the model wants discrete terms. */
function glossaryTerms(raw: string | null): string[] | undefined {
  if (!raw) return undefined
  const terms = raw
    .split(/[,\n]/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
  if (terms.length === 0) return undefined
  return [...new Set(terms)].slice(0, MAX_GLOSSARY_TERMS)
}

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authenticateGenerativePost(request)
  if (!authenticated.ok) return authenticated.response
  const { body, signer } = authenticated

  const req = parseRequest(body)
  if (!req) return Response.json({ error: 'invalid request' }, { status: 400 })

  const mimeType = mimeTypeFor(req.uri)
  if (!mimeType) return Response.json({ error: 'unsupported_audio_type' }, { status: 400 })

  const limited = await checkPixelsRateLimits(request, 'transcribe', {
    ip: false,
    identity: signer,
  })
  if (limited) return limited

  const accountId = signer.toLowerCase()
  const job = await readTranscriptionJob(req.jobId)
  // Another account's job reads as missing, so ids cannot be probed for existence.
  if (!job || job.accountId !== accountId) {
    return Response.json({ error: 'job not found' }, { status: 404 })
  }

  // `quoted` means the quote exists but nobody has paid for it yet: transcribing then would
  // spend our money on an unpaid job. Batch jobs (`running` with an operation) are driven by
  // Google instead, so they are refused here too.
  if (job.status !== 'running' || job.operationName !== null) {
    return Response.json({ error: 'job_not_payable', status: job.status }, { status: 409 })
  }

  if (!isOwnedInputUri(req.uri, { accountId, jobId: req.jobId })) {
    return Response.json({ error: 'file_not_owned_by_job' }, { status: 400 })
  }

  const vocabulary = glossaryTerms(job.glossary)
  try {
    const result = await transcribeFile({
      fileUri: req.uri,
      mimeType,
      options: {
        mode: 'VERBATIM',
        wordTimestamp: true,
        diarization: true,
        ...(vocabulary ? { customVocabulary: vocabulary } : {}),
      },
    })

    const response: TranscribePartResponse = {
      jobId: req.jobId,
      partIndex: req.partIndex,
      text: result.text,
      segments: result.segments,
      usage: result.usage,
      finishReason: result.finishReason,
    }
    return Response.json(response)
  } catch (error) {
    // The model rejects an over-long or unsupported file, and a truncated answer throws from
    // the parser. Both are per-part failures the client retries by splitting, not job deaths.
    console.error('transcription part failed', {
      jobId: req.jobId,
      partIndex: req.partIndex,
      error,
    })
    return Response.json({ error: 'part_failed' }, { status: 502 })
  }
}
