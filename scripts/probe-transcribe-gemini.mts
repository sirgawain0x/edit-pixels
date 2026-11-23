/**
 * Live probe for the cloud transcription tier (gemini-3.5-transcribe).
 *
 * Mocks prove the request shape; only this proves the wire. Run by hand:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/probe-transcribe-gemini.mts clip.flac
 *
 * Needs ADC — or `VERTEX_TOKEN` in the environment, which is the workaround when the
 * local ADC refresh hangs on oauth2.googleapis.com. Uploads to the test account's own
 * input prefix and deletes the object afterwards. A 10-minute clip costs about six
 * cents, so prefer a short one.
 */
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import {
  MAX_PRECISION_CHUNK_SECONDS,
  transcribeFile,
  type TranscriptionOptions,
  type TranscriptionResult,
} from '../api/_transcribe-gemini.js'
import { getVertexAccessToken } from '../api/_vertex-auth.js'
import { transcribeBucket } from '../api/_transcribe-uris.js'

/** The account used for incident triage; keeps probe objects out of customer prefixes. */
const PROBE_ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mp3',
  '.m4a': 'audio/m4a',
  '.ogg': 'audio/ogg',
  '.aiff': 'audio/aiff',
}

/** Everything the editor needs from one request: offsets plus speaker turns. */
const OPTIONS: TranscriptionOptions = {
  mode: 'VERBATIM',
  wordTimestamp: true,
  diarization: true,
}

function mimeTypeOf(clipPath: string): string | null {
  return MIME_BY_EXTENSION[extname(clipPath).toLowerCase()] ?? null
}

async function uploadClip(input: {
  headers: Record<string, string>
  clipPath: string
  mimeType: string
}): Promise<{ fileUri: string; objectName: string; bytes: number }> {
  const bucket = transcribeBucket()
  const objectName = `input/${PROBE_ACCOUNT}/probe-${Date.now()}/${basename(input.clipPath)}`
  const bytes = readFileSync(input.clipPath)

  const init = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=resumable&name=${encodeURIComponent(objectName)}`,
    { method: 'POST', headers: input.headers, body: JSON.stringify({ contentType: input.mimeType }) },
  )
  const session = init.headers.get('location')
  if (!session) throw new Error(`upload session failed: ${await init.text()}`)
  await fetch(session, {
    method: 'PUT',
    headers: { 'Content-Type': input.mimeType },
    body: bytes,
  })
  return { fileUri: `gs://${bucket}/${objectName}`, objectName, bytes: bytes.byteLength }
}

async function deleteClip(headers: Record<string, string>, objectName: string): Promise<void> {
  await fetch(
    `https://storage.googleapis.com/storage/v1/b/${transcribeBucket()}/o/${encodeURIComponent(objectName)}`,
    { method: 'DELETE', headers },
  )
}

function secondsOrZero(value: number | null): string {
  return (value ?? 0).toFixed(2)
}

function spanOf(segment: {
  words: Array<{ startSeconds: number | null; endSeconds: number | null }>
}): string {
  const first = segment.words[0]
  const last = segment.words.at(-1)
  if (!first || !last) return 'no word offsets'
  return `${secondsOrZero(first.startSeconds)}s-${secondsOrZero(last.endSeconds)}s`
}

function printTranscript(result: TranscriptionResult, elapsedMs: number): void {
  console.log(
    `\nlatency ${elapsedMs}ms  model=${result.modelVersion}  usage=${JSON.stringify(result.usage)}`,
  )
  for (const segment of result.segments) {
    console.log(
      `[${segment.speakerLabel ?? 'speaker?'}] ${spanOf(segment)} (${segment.words.length} words) ${segment.text}`,
    )
  }
  console.log(`\nfull text: ${result.text}`)
}

/**
 * Audio past the cap is silently truncated and still reported as completed, so the
 * warning is the only signal that a chunk was too long.
 */
function warnIfTruncated(result: TranscriptionResult): void {
  const lastEnd = Math.max(
    0,
    ...result.segments.map((segment) => segment.words.at(-1)?.endSeconds ?? 0),
  )
  if (lastEnd > MAX_PRECISION_CHUNK_SECONDS) {
    console.warn(
      `\nwarning: transcript ends at ${lastEnd}s, past the ${MAX_PRECISION_CHUNK_SECONDS}s cap — ` +
        'the tail was truncated but the response still says completed.',
    )
  }
}

function usage(): void {
  console.error(
    'usage: probe-transcribe-gemini.mts <audio-file (.flac|.wav|.mp3|.m4a|.ogg|.aiff)>',
  )
  process.exitCode = 1
}

async function main(): Promise<void> {
  const clipPath = process.argv[2]
  if (!clipPath) return usage()
  const mimeType = mimeTypeOf(clipPath)
  if (!mimeType) return usage()

  const token = process.env.VERTEX_TOKEN ?? (await getVertexAccessToken())
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const { fileUri, objectName, bytes } = await uploadClip({ headers, clipPath, mimeType })
  console.log(`uploaded ${fileUri} (${bytes} bytes, ${mimeType})`)

  try {
    const startedAt = Date.now()
    const result = await transcribeFile({ fileUri, mimeType, options: OPTIONS }, { accessToken: token })
    printTranscript(result, Date.now() - startedAt)
    warnIfTruncated(result)
  } finally {
    await deleteClip(headers, objectName)
    console.log('\ncleaned up')
  }
}

await main()
