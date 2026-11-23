/// <reference types="node" />
/**
 * gemini-3.5-transcribe wire layer for the cloud ("precision") tier.
 *
 * The shape below is taken from the model's own SDK declarations
 * (`@google/genai` -> `AudioTranscriptionConfig`), because the public docs page
 * documents a DIFFERENT surface and following it wastes a lot of time:
 *
 *   - The docs show `transcription_config: { mode: { type: "verbatim",
 *     timestamp_granularities: [...], diarization_mode: "speaker" } }`. That is the
 *     *Interactions* API only. On `generateContent` the field is
 *     `audioTranscriptionConfig`, `mode` is the enum string "VERBATIM"/"SMART", and
 *     word timestamps are a single boolean named `wordTimestamp` (singular).
 *     Passing the documented `mode: {...}` object returns
 *     `Invalid value at 'generation_config.audio_transcription_config' (mode)`.
 *   - `customVocabulary` is accepted *alongside* timestamps and diarization here, and
 *     the bias is genuinely applied. Verified with a nonsense-word control:
 *     "Kwyjibo" comes back as "Quijibo" unbiased, and correctly spelled with the
 *     vocabulary present — with and without timestamps. The model page's
 *     "incompatible with diarization and timestamps" row describes the Interactions
 *     API, not this one. A local glossary overlay is still worth keeping for a
 *     different reason: changing glossary terms then never re-bills a transcription.
 *   - `sourceText` (voice editing: rewrite a supplied draft from spoken
 *     instructions) is SMART-only. On VERBATIM the server rejects it with
 *     "source_text is only supported when transcription mode is explicitly set to
 *     SMART", so the builder refuses it locally.
 *   - SMART is genuinely incompatible with `wordTimestamp` — the server rejects it
 *     with "Transcription mode SMART is incompatible with word timestamps".
 *   - The model is not on the Interactions API at all for this project, and it is
 *     only served from `locations/global`.
 *
 * Response shape: one part per *speaker turn*, each carrying
 * `audioTranscription: { text, speakerLabel: "spk:0", words: [{ word,
 * startOffset: "0.100s", endOffset: "0.600s" }] }`. Offsets are protobuf-ish
 * duration strings, not numbers, and the first word of a stream may omit them.
 */
import { getVertexAccessToken, getVertexProject } from './_vertex-auth.js'

const DEFAULT_LOCATION = 'global'
const MODEL_ID = 'gemini-3.5-transcribe'
/** A 20-minute chunk finishes in ~42s at measured throughput; this is pure headroom. */
const REQUEST_TIMEOUT_MS = 600_000

/**
 * Docs cap unary audio at 1 hour, and at 30 minutes once timestamps or diarization
 * are on (longer input is truncated silently and still reports `completed`).
 *
 * We cut at 20 minutes rather than the full 30: it keeps a 10-minute margin under
 * the documented ceiling, matches the planner's existing 1199.5s wall, and costs
 * nothing in COGS — audio tokens are linear, and a 20-minute request runs ~42s at
 * the measured 28.6x realtime, well inside a serverless timeout.
 */
export const MAX_PRECISION_CHUNK_SECONDS = 20 * 60

/** Model page: `source_text` accepts up to 64 KiB. */
const MAX_SOURCE_TEXT_BYTES = 64 * 1024

export type TranscriptionMode = 'VERBATIM' | 'SMART'

export interface TranscriptionOptions {
  /** BCP-47 codes; omit for automatic detection. */
  languageCodes?: string[]
  /** Up to 1,000 phrases; best results under 100. */
  customVocabulary?: string[]
  /** Word-level offsets. Incompatible with mode SMART. */
  wordTimestamp?: boolean
  /** Speaker labels ("spk:0"), up to 8 speakers. Incompatible with mode SMART. */
  diarization?: boolean
  /** Defaults to VERBATIM, matching the model. */
  mode?: TranscriptionMode
  /**
   * Voice editing: the draft being edited. Spoken instructions in the audio are
   * applied to this text and the *rewritten* result comes back. SMART mode only.
   */
  sourceText?: string
}

export interface TranscriptWord {
  word: string
  startSeconds: number | null
  endSeconds: number | null
}

export interface TranscriptSegment {
  /** null when diarization was not requested. */
  speakerLabel: string | null
  text: string
  words: TranscriptWord[]
}

export interface TranscriptionUsage {
  audioPromptTokens: number | null
  textPromptTokens: number | null
  outputTokens: number | null
}

export interface TranscriptionResult {
  segments: TranscriptSegment[]
  /** Convenience join of every segment, for the common "just the words" case. */
  text: string
  usage: TranscriptionUsage
  modelVersion: string | null
}

export interface TranscribeFileInput {
  /** gs:// URI or any URL Vertex can read. */
  fileUri: string
  mimeType: string
  options?: TranscriptionOptions
}

/** Injectable for tests and local probes; production resolves ADC. */
export interface TranscribeDeps {
  accessToken?: string
  fetchImpl?: typeof fetch
}

function modelUrl(location: string): string {
  const project = getVertexProject()
  return (
    `https://aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${location}` +
    `/publishers/google/models/${MODEL_ID}:generateContent`
  )
}

/**
 * SMART does cleanup and reformatting, which rewrites the text and destroys the
 * offset/speaker mapping — the server refuses the combination rather than
 * silently dropping one, so refuse it here too instead of spending a round trip.
 */
export function buildTranscriptionConfig(
  options: TranscriptionOptions = {},
): Record<string, unknown> {
  const mode = options.mode ?? 'VERBATIM'
  assertFlagsAllowed(mode, options)

  const config: Record<string, unknown> = { mode }
  applyList(config, 'languageCodes', options.languageCodes)
  applyList(config, 'customVocabulary', options.customVocabulary)
  applyFlag(config, 'wordTimestamp', options.wordTimestamp)
  applyFlag(config, 'diarization', options.diarization)
  applySourceText(config, options, mode)
  return config
}

/** Both flags rewrite or re-time the text, so SMART and either one cannot coexist. */
function assertFlagsAllowed(mode: TranscriptionMode, options: TranscriptionOptions): void {
  const wantsTiming = options.wordTimestamp === true || options.diarization === true
  if (mode === 'SMART' && wantsTiming) {
    throw new Error('SMART mode cannot be combined with wordTimestamp or diarization')
  }
}

function applyFlag(config: Record<string, unknown>, key: string, value: boolean | undefined): void {
  if (value === true) config[key] = true
}

/** Empty vocabulary or language lists mean "no opinion", so they are not sent. */
function applyList(
  config: Record<string, unknown>,
  key: string,
  value: string[] | undefined,
): void {
  if (value !== undefined && value.length > 0) config[key] = value
}

function applySourceText(
  config: Record<string, unknown>,
  options: TranscriptionOptions,
  mode: TranscriptionMode,
): void {
  const sourceText = sourceTextOf(options, mode)
  if (sourceText !== null) config.sourceText = sourceText
}

/**
 * Voice editing needs SMART; the server answers VERBATIM with
 * "source_text is only supported when transcription mode is explicitly set to SMART".
 */
function sourceTextOf(options: TranscriptionOptions, mode: TranscriptionMode): string | null {
  if (options.sourceText === undefined) return null
  if (mode !== 'SMART') throw new Error('sourceText requires SMART mode')
  if (new TextEncoder().encode(options.sourceText).length > MAX_SOURCE_TEXT_BYTES) {
    throw new Error(`sourceText exceeds ${MAX_SOURCE_TEXT_BYTES} bytes`)
  }
  return options.sourceText
}

/** `"0.100s"` / `"1s"` / `0.5` -> seconds; null when the value is not a duration. */
export function secondsFromOffset(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value.trim())
  if (!match) return null
  const seconds = Number(match[1])
  return Number.isFinite(seconds) ? seconds : null
}

function wordsOf(raw: unknown): TranscriptWord[] {
  if (!Array.isArray(raw)) return []
  const words: TranscriptWord[] = []
  for (const entry of raw) {
    const word = (entry ?? {}) as { word?: unknown; startOffset?: unknown; endOffset?: unknown }
    if (typeof word.word !== 'string' || word.word.length === 0) continue
    words.push({
      word: word.word,
      startSeconds: secondsFromOffset(word.startOffset),
      endSeconds: secondsFromOffset(word.endOffset),
    })
  }
  return words
}

/** A non-empty string, or null — the model omits fields rather than sending "". */
function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function segmentOf(part: unknown): TranscriptSegment | null {
  const typed = (part ?? {}) as {
    text?: unknown
    audioTranscription?: { text?: unknown; speakerLabel?: unknown; words?: unknown }
  }
  const transcription = typed.audioTranscription
  // `audioTranscription.text` is the canonical field; `text` is the plain mirror.
  const text = nonEmptyString(transcription?.text) ?? nonEmptyString(typed.text)
  if (text === null) return null
  return {
    speakerLabel: nonEmptyString(transcription?.speakerLabel),
    text,
    words: wordsOf(transcription?.words),
  }
}

function tokenCount(raw: unknown): number | null {
  const value = (raw as { tokenCount?: unknown } | undefined)?.tokenCount
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function tokensByModality(raw: unknown, modality: string): number | null {
  if (!Array.isArray(raw)) return null
  for (const entry of raw) {
    const details = entry as { modality?: unknown; tokenCount?: unknown }
    if (details.modality === modality) return tokenCount(details)
  }
  return null
}

/**
 * Read a generateContent body into segments.
 *
 * A 200 with no usable part is a failure, not an empty transcript: the caller has
 * already paid for the request, so returning "" would bill a user for silence.
 */
export function parseTranscriptionResponse(body: unknown): TranscriptionResult {
  const typed = (body ?? {}) as {
    candidates?: Array<{ content?: { parts?: unknown } }>
    usageMetadata?: unknown
    modelVersion?: unknown
  }
  const parts = typed.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) throw new Error('transcription response had no candidates')

  const segments = parts
    .map((part) => segmentOf(part))
    .filter((segment): segment is TranscriptSegment => segment !== null)
  if (segments.length === 0) throw new Error('transcription response had no text')

  const usageMetadata = typed.usageMetadata as
    | { promptTokensDetails?: unknown; candidatesTokenCount?: unknown }
    | undefined

  return {
    segments,
    text: segments.map((segment) => segment.text).join(' '),
    usage: {
      audioPromptTokens: tokensByModality(usageMetadata?.promptTokensDetails, 'AUDIO'),
      textPromptTokens: tokensByModality(usageMetadata?.promptTokensDetails, 'TEXT'),
      outputTokens: tokenCount({ tokenCount: usageMetadata?.candidatesTokenCount }),
    },
    modelVersion: typeof typed.modelVersion === 'string' ? typed.modelVersion : null,
  }
}

/** Transcribe one file. Unary: the whole result comes back in this response. */
export async function transcribeFile(
  input: TranscribeFileInput,
  deps: TranscribeDeps = {},
): Promise<TranscriptionResult> {
  const token = deps.accessToken ?? (await getVertexAccessToken())
  const doFetch = deps.fetchImpl ?? fetch
  const location = process.env.TRANSCRIBE_VERTEX_LOCATION?.trim() || DEFAULT_LOCATION

  const response = await doFetch(modelUrl(location), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ fileData: { fileUri: input.fileUri, mimeType: input.mimeType } }],
        },
      ],
      generationConfig: {
        audioTranscriptionConfig: buildTranscriptionConfig(input.options),
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Transcribe error ${response.status}: ${text.slice(0, 500)}`)
  }
  return parseTranscriptionResponse(await response.json())
}
