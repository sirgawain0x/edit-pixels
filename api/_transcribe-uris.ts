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
  // `..`/`.` segments would let a key escape the prefix it appears to sit under.
  if (key.split('/').some((segment) => segment === '..' || segment === '.')) return null
  return { bucket, key }
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
