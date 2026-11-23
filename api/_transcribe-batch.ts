/// <reference types="node" />
/**
 * Google Speech v2 BatchRecognize wire layer for the cloud ("precision") tier.
 *
 * The shapes here come from real captured operations, not from the REST
 * reference — see `src/features/media-library/transcription/chirp/fixtures/
 * {op_poll,poll4}.json`. Three things the captures settled that the docs do not
 * make obvious:
 *
 *   - Speech v2 lives at `locations/us`, not the `us-central1` that every other
 *     Vertex API in this repo uses.
 *   - `results` is a map keyed by the *input* URI, and a failed file still comes
 *     back with a `uri` and a `cloudStorageResult` — only `error` distinguishes
 *     it. A missing `metadata` is a failure, never a zero-cost success.
 *   - Durations are protobuf strings like `"1140s"`, and a rejected batch reports
 *     `totalBilledDuration: "0s"` — which reads exactly like a free job.
 *
 * Diarization is deliberately NOT requested: on chirp_3 it silently truncates
 * words, which is worse than not knowing who spoke.
 */
import { getVertexAccessToken } from './_vertex-auth.js'

/**
 * Speech v2 is only served from multi-region `us` in this project; the captured
 * resources are `projects/<n>/locations/us/recognizers/_`.
 */
const DEFAULT_SPEECH_LOCATION = 'us'
const REQUEST_TIMEOUT_MS = 30_000

function speechLocation(): string {
  return process.env.TRANSCRIBE_SPEECH_LOCATION?.trim() || DEFAULT_SPEECH_LOCATION
}

/**
 * Authenticated JSON fetch against Speech v2.
 *
 * Only the poll reader uses this now: submission moved to the unary model, so this exists
 * for jobs that were already submitted as batches before that change.
 */
async function speechFetch<T>(url: string, init: RequestInit): Promise<T> {
  const token = await getVertexAccessToken()
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Speech error ${response.status}: ${text}`)
  }
  return (await response.json()) as T
}

/**
 * One input file's outcome from a batch operation.
 *
 * `billedSeconds` is null when Google reported no duration: a rejected file reports `"0s"`,
 * which must not be read as free. The reconciler maps these back by *input* uri.
 */
interface BatchFileResult {
  inputUri: string
  outputUri: string | null
  billedSeconds: number | null
  errorMessage: string | null
}

interface BatchOperationSummary {
  status: 'running' | 'completed' | 'failed'
  progressPercent: number
  files: BatchFileResult[]
  totalBilledSeconds: number | null
  errorMessage: string | null
}

/**
 * Protobuf duration (`"1140s"`) to seconds. A rejected batch reports `"0s"`, which reads
 * exactly like a free job, so callers must not treat a missing value as zero.
 */
function secondsFromProtoDuration(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value.trim())
  if (!match) return null
  const seconds = Number(match[1])
  return Number.isFinite(seconds) ? seconds : null
}

export type { BatchFileResult, BatchOperationSummary }

function fileResultsFromResponse(response: unknown): BatchFileResult[] {
  const results = (response as { results?: Record<string, unknown> } | null)?.results
  if (!results || typeof results !== 'object') return []

  return Object.entries(results).map(([inputUri, raw]) => {
    const result = (raw ?? {}) as {
      uri?: unknown
      metadata?: { totalBilledDuration?: unknown }
      cloudStorageResult?: { uri?: unknown }
      error?: { message?: unknown }
    }
    const outputUri =
      typeof result.cloudStorageResult?.uri === 'string'
        ? result.cloudStorageResult.uri
        : typeof result.uri === 'string'
          ? result.uri
          : null
    return {
      inputUri,
      outputUri,
      billedSeconds: secondsFromProtoDuration(result.metadata?.totalBilledDuration),
      errorMessage:
        typeof result.error?.message === 'string' && result.error.message.length > 0
          ? result.error.message
          : null,
    }
  })
}

/** Progress as 0-100; anything not a finite number reads as "not started". */
function progressOf(metadata: unknown): number {
  const value = (metadata as { progressPercent?: unknown } | undefined)?.progressPercent
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

/** An operation-level error message, or null when the operation reports none. */
function operationErrorOf(error: unknown): string | null {
  const message = (error as { message?: unknown } | undefined)?.message
  if (typeof message !== 'string' || message.length === 0) return null
  return message
}

function runningSummary(
  progressPercent: number,
  errorMessage: string | null,
): BatchOperationSummary {
  return {
    status: 'running',
    progressPercent,
    files: [],
    totalBilledSeconds: null,
    errorMessage,
  }
}

function failedSummary(progressPercent: number, errorMessage: string): BatchOperationSummary {
  return {
    status: 'failed',
    progressPercent,
    files: [],
    totalBilledSeconds: null,
    errorMessage,
  }
}

function completedSummary(response: unknown, progressPercent: number): BatchOperationSummary {
  return {
    status: 'completed',
    progressPercent,
    files: fileResultsFromResponse(response),
    totalBilledSeconds: secondsFromProtoDuration(
      (response as { totalBilledDuration?: unknown }).totalBilledDuration,
    ),
    errorMessage: null,
  }
}

/**
 * Read an operation into the three states the job cares about.
 *
 * A finished operation with neither a response nor an error cannot be reconciled,
 * so it is reported as failed rather than "completed with nothing".
 */
function parseBatchOperation(operation: unknown): BatchOperationSummary {
  const raw = (operation ?? {}) as {
    done?: unknown
    error?: unknown
    metadata?: unknown
    response?: unknown
  }
  const progressPercent = progressOf(raw.metadata)
  const operationError = operationErrorOf(raw.error)

  if (raw.done !== true) return runningSummary(progressPercent, operationError)
  if (operationError) return failedSummary(progressPercent, operationError)
  if (!raw.response) return failedSummary(progressPercent, 'operation finished without a response')
  return completedSummary(raw.response, 100)
}

/** Poll an operation. Refuses anything that is not an operations/ resource name. */
export async function pollTranscriptionOperation(
  operationName: string,
): Promise<BatchOperationSummary> {
  if (!/^projects\/[^/]+\/locations\/[^/]+\/operations\/[\w-]+$/.test(operationName)) {
    throw new Error('invalid operation name')
  }
  const operation = await speechFetch<unknown>(
    `https://${speechLocation()}-speech.googleapis.com/v2/${operationName}`,
    {
      method: 'GET',
    },
  )
  return parseBatchOperation(operation)
}
