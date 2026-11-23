/// <reference types="node" />
/**
 * Bucket layout and the ownership guard for batch transcription files.
 *
 * Kept apart from the Google wire layer because this is a security boundary, not
 * protocol: BatchRecognize will happily transcribe any object our service account
 * can read, so a client-supplied `gs://` URI must be proved to belong to the job
 * that is asking before it is ever submitted.
 */

const DEFAULT_BUCKET = 'creative-pixels-transcribe-batch'

export function transcribeBucket(): string {
  return process.env.TRANSCRIBE_GCS_BUCKET?.trim() || DEFAULT_BUCKET
}

/**
 * Where a job's audio must live. Scoping uploads by account and job is what makes
 * a client-supplied URI safe to hand to Google: it can only ever point at a prefix
 * this job owns.
 */
export function inputPrefixFor(accountId: string, jobId: string): string {
  return `input/${accountId.toLowerCase()}/${jobId}/`
}

/**
 * `gs://bucket/key` split, or null when the URI is not shaped like one. Exported so
 * the GCS helpers can reuse the same parsing the security guard relies on.
 */
export function splitGcsUri(uri: string): { bucket: string; key: string } | null {
  if (!uri.startsWith('gs://')) return null
  const rest = uri.slice('gs://'.length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash === rest.length - 1) return null
  const bucket = rest.slice(0, slash)
  const key = rest.slice(slash + 1)
  // `..`/`.` segments would let a key escape the prefix it appears to sit under.
  if (key.split('/').some((segment) => segment === '..' || segment === '.')) return null
  return { bucket, key }
}

/** Audio containers the browser can plausibly produce and BatchRecognize accepts. */
const UPLOAD_CONTENT_TYPES = ['audio/webm', 'audio/ogg', 'audio/flac', 'audio/wav'] as const

export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number]

export function isUploadContentType(value: unknown): value is UploadContentType {
  return typeof value === 'string' && (UPLOAD_CONTENT_TYPES as readonly string[]).includes(value)
}

/**
 * A file name the client may use: one path segment, no traversal, bounded length.
 * The account/job prefix is added by the caller, never by the client.
 */
export function isSafePartName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)
}

/**
 * True only for a URI inside this job's own input prefix in our own bucket.
 *
 * An allowlist, never a blocklist: "not obviously wrong" is not good enough when
 * the consequence is transcribing (and paying for) someone else's object.
 */
export function isOwnedInputUri(uri: string, owner: { accountId: string; jobId: string }): boolean {
  const parsed = splitGcsUri(uri)
  if (!parsed) return false
  if (parsed.bucket !== transcribeBucket()) return false
  return parsed.key.startsWith(inputPrefixFor(owner.accountId, owner.jobId))
}
