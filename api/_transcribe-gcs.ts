/// <reference types="node" />
/**
 * GCS plumbing for transcription uploads.
 *
 * Two jobs, both chosen to avoid a service-account key: under WIF the API has no
 * private key, so a V4 signed URL would need an extra `signBlob` grant. Instead:
 *
 *  - `createUploadSession` asks GCS for a **resumable session**, which is
 *    pre-authorized: the browser PUTs bytes straight to Google with no auth header,
 *    and Vercel's 4.5 MB body cap never applies because the bytes never touch it.
 *  - `statObject` lets the submit route prove every part really landed before any
 *    money is spent or Google is asked to transcribe a hole.
 *
 * Verified against the real bucket: initiate 200 -> unauthenticated PUT 200 ->
 * object HEAD 200 -> delete 204.
 */
import { getVertexAccessToken } from './_vertex-auth.js'
import { splitGcsUri, transcribeBucket, type UploadContentType } from './_transcribe-uris.js'

const STORAGE_API = 'https://storage.googleapis.com/storage/v1'
const UPLOAD_API = 'https://storage.googleapis.com/upload/storage/v1'
const REQUEST_TIMEOUT_MS = 15_000

async function accessToken(): Promise<string> {
  return getVertexAccessToken()
}

/**
 * Create a resumable upload session for one object.
 *
 * The returned URI is a bearer capability: whoever holds it can write that object,
 * so it may only ever point inside the caller's own `input/<account>/<job>/` prefix.
 *
 * `ifGenerationMatch=0` makes the write create-only. GCS enforces it at finalize,
 * not at session creation, so a second session for a part that already landed still
 * gets a URI — and then fails with 412 instead of replacing the audio. That closes
 * the window where a client could re-upload a part after `transcribe-submit`
 * verified it and Google had already started reading the old bytes. Retrying the
 * *same* session stays possible, because a resumable session is resumable; only
 * starting over is blocked.
 *
 * `origin` is the browser's Origin, forwarded as-is. GCS mirrors it back as
 * `Access-Control-Allow-Origin` on the session and on the PUT; without it the upload
 * still lands but the browser cannot read the response, which surfaces as a CORS
 * failure. Verified both ways against the real bucket.
 */
export async function createUploadSession(input: {
  objectName: string
  contentType: UploadContentType
  metadata?: Record<string, string>
  /** Same-origin only — see `sameOriginOf` in the route. */
  origin?: string | null
}): Promise<{ sessionUri: string }> {
  const token = await accessToken()
  const url =
    `${UPLOAD_API}/b/${encodeURIComponent(transcribeBucket())}/o` +
    `?uploadType=resumable&name=${encodeURIComponent(input.objectName)}` +
    `&ifGenerationMatch=0`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(input.origin ? { Origin: input.origin } : {}),
    },
    body: JSON.stringify({
      contentType: input.contentType,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`GCS upload session failed (${response.status}): ${detail}`)
  }

  const sessionUri = response.headers.get('location')
  if (!sessionUri) throw new Error('GCS upload session response carried no Location')
  // Defensive: never hand the client a URI on a host we did not ask for.
  if (new URL(sessionUri).host !== 'storage.googleapis.com') {
    throw new Error('GCS upload session pointed at an unexpected host')
  }
  return { sessionUri }
}

interface ObjectStat {
  sizeBytes: number
  contentType: string | null
}

/**
 * Confirm an object exists and report its size.
 *
 * Returns null when the object is missing. Throws on any other failure, so the
 * submit route can refuse rather than transcribe a batch with holes in it.
 */
async function statObject(uri: string): Promise<ObjectStat | null> {
  const parsed = splitGcsUri(uri)
  if (!parsed) throw new Error(`not a gs:// uri: ${uri}`)

  const token = await accessToken()
  const url =
    `${STORAGE_API}/b/${encodeURIComponent(parsed.bucket)}/o/` +
    `${encodeURIComponent(parsed.key)}?fields=size,contentType`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (response.status === 404) return null
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`GCS object stat failed (${response.status}): ${detail}`)
  }

  const body = (await response.json()) as { size?: unknown; contentType?: unknown }
  const size = Number(body.size)
  return {
    sizeBytes: Number.isFinite(size) ? size : 0,
    contentType: typeof body.contentType === 'string' ? body.contentType : null,
  }
}

interface StatSummary {
  uri: string
  exists: boolean
  sizeBytes: number
}

/** Stat every part in parallel; a zero-byte object counts as missing. */
export async function statParts(uris: string[]): Promise<StatSummary[]> {
  return Promise.all(
    uris.map(async (uri) => {
      const stat = await statObject(uri)
      return {
        uri,
        exists: stat !== null && stat.sizeBytes > 0,
        sizeBytes: stat?.sizeBytes ?? 0,
      }
    }),
  )
}
