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
import { transcribeBucket } from './_transcribe-uris.js'
import { getVertexAccessToken, getVertexProject } from './_vertex-auth.js'

/**
 * Speech v2 is only served from multi-region `us` in this project; the captured
 * resources are `projects/<n>/locations/us/recognizers/_`.
 */
const DEFAULT_SPEECH_LOCATION = 'us'
const DEFAULT_MODEL = 'chirp_3'
const DEFAULT_LANGUAGE = 'en-US'
const REQUEST_TIMEOUT_MS = 30_000

function speechLocation(): string {
  return process.env.TRANSCRIBE_SPEECH_LOCATION?.trim() || DEFAULT_SPEECH_LOCATION
}

export interface BatchInputFile {
  uri: string
  /** Per-file override; the whole batch otherwise uses the request-level language. */
  languageCode?: string
}

export interface BatchFileResult {
  inputUri: string
  outputUri: string | null
  billedSeconds: number | null
  errorMessage: string | null
}

export type BatchOperationStatus = 'running' | 'completed' | 'failed'

export interface BatchOperationSummary {
  status: BatchOperationStatus
  progressPercent: number
  files: BatchFileResult[]
  /** Sum across files as reported by the operation; null when it never reported one. */
  totalBilledSeconds: number | null
  errorMessage: string | null
}

function secondsFromProtoDuration(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value.trim())
  if (!match) return null
  const seconds = Number(match[1])
  return Number.isFinite(seconds) ? seconds : null
}

/** The request body Google echoes back in `metadata.batchRecognizeRequest`. */
function buildBatchRecognizeRequest(input: {
  files: BatchInputFile[]
  languageCode?: string
}): Record<string, unknown> {
  const project = getVertexProject()
  const location = speechLocation()
  return {
    recognizer: `projects/${project}/locations/${location}/recognizers/_`,
    files: input.files.map((file) => ({
      uri: file.uri,
      ...(file.languageCode ? { config: { languageCodes: [file.languageCode] } } : {}),
    })),
    config: {
      autoDecodingConfig: {},
      model: DEFAULT_MODEL,
      languageCodes: [input.languageCode ?? DEFAULT_LANGUAGE],
      features: {
        enableWordTimeOffsets: true,
        enableAutomaticPunctuation: true,
      },
    },
    recognitionOutputConfig: {
      gcsOutputConfig: { uri: `gs://${transcribeBucket()}/output/` },
    },
  }
}

function speechBaseUrl(): string {
  const location = speechLocation()
  return `https://${location}-speech.googleapis.com/v2`
}

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
 * Start a batch. Returns the long-running operation name, which is the only
 * handle to the job's progress and billing from that point on.
 */
export async function submitTranscriptionBatch(input: {
  files: BatchInputFile[]
  languageCode?: string
}): Promise<{ operationName: string }> {
  if (input.files.length === 0) throw new Error('batch needs at least one file')

  const project = getVertexProject()
  const location = speechLocation()
  const url = `${speechBaseUrl()}/projects/${project}/locations/${location}/recognizers/_:batchRecognize`

  const operation = await speechFetch<{ name?: string }>(url, {
    method: 'POST',
    body: JSON.stringify(buildBatchRecognizeRequest(input)),
  })
  if (!operation.name) throw new Error('Speech returned no operation name')
  return { operationName: operation.name }
}

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
