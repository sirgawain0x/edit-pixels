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
import { getVertexAccessToken, getVertexProject } from './_vertex-auth.js'

const DEFAULT_BUCKET = 'creative-pixels-transcribe-batch'
/**
 * Speech v2 is only served from multi-region `us` in this project; the captured
 * resources are `projects/<n>/locations/us/recognizers/_`.
 */
const DEFAULT_SPEECH_LOCATION = 'us'
const DEFAULT_MODEL = 'chirp_3'
const DEFAULT_LANGUAGE = 'en-US'
const REQUEST_TIMEOUT_MS = 30_000

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

function transcribeBucket(): string {
  return process.env.TRANSCRIBE_GCS_BUCKET?.trim() || DEFAULT_BUCKET
}

function speechLocation(): string {
  return process.env.TRANSCRIBE_SPEECH_LOCATION?.trim() || DEFAULT_SPEECH_LOCATION
}

/**
 * Where a job's audio must live. Scoping uploads by account and job is what makes
 * a client-supplied `gs://` URI safe to hand to Google: it can only ever point at
 * a prefix this job owns.
 */
function inputPrefixFor(accountId: string, jobId: string): string {
  return `input/${accountId.toLowerCase()}/${jobId}/`
}

/** `gs://bucket/key` split, or null when the URI is not shaped like one. */
function splitGcsUri(uri: string): { bucket: string; key: string } | null {
  if (!uri.startsWith('gs://')) return null
  const rest = uri.slice('gs://'.length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash === rest.length - 1) return null
  const bucket = rest.slice(0, slash)
  const key = rest.slice(slash + 1)
  if (key.split('/').some((segment) => segment === '..' || segment === '.')) return null
  return { bucket, key }
}

/**
 * True only for a URI inside this job's own input prefix in our own bucket.
 *
 * Any other answer means a client is trying to make us transcribe (and bill for)
 * someone else's object, so this has to be an allowlist, never a blocklist.
 */
export function isOwnedInputUri(uri: string, owner: { accountId: string; jobId: string }): boolean {
  const parsed = splitGcsUri(uri)
  if (!parsed) return false
  if (parsed.bucket !== transcribeBucket()) return false
  return parsed.key.startsWith(inputPrefixFor(owner.accountId, owner.jobId))
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

/**
 * Read an operation into the three states the job cares about.
 *
 * A finished operation with neither a response nor an error cannot be reconciled,
 * so it is reported as failed rather than "completed with nothing".
 */
function parseBatchOperation(operation: unknown): BatchOperationSummary {
  const raw = (operation ?? {}) as {
    done?: unknown
    error?: { message?: unknown }
    metadata?: { progressPercent?: unknown }
    response?: unknown
  }

  const progressRaw = raw.metadata?.progressPercent
  const progressPercent =
    typeof progressRaw === 'number' && Number.isFinite(progressRaw)
      ? Math.max(0, Math.min(100, progressRaw))
      : 0

  const operationError =
    typeof raw.error?.message === 'string' && raw.error.message.length > 0
      ? raw.error.message
      : null

  if (raw.done !== true) {
    return {
      status: 'running',
      progressPercent,
      files: [],
      totalBilledSeconds: null,
      errorMessage: operationError,
    }
  }

  if (operationError) {
    return {
      status: 'failed',
      progressPercent,
      files: [],
      totalBilledSeconds: null,
      errorMessage: operationError,
    }
  }

  if (!raw.response) {
    return {
      status: 'failed',
      progressPercent,
      files: [],
      totalBilledSeconds: null,
      errorMessage: 'operation finished without a response',
    }
  }

  const totalBilledSeconds = secondsFromProtoDuration(
    (raw.response as { totalBilledDuration?: unknown }).totalBilledDuration,
  )
  return {
    status: 'completed',
    progressPercent: 100,
    files: fileResultsFromResponse(raw.response),
    totalBilledSeconds,
    errorMessage: null,
  }
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
