/**
 * Upload transcription sub-files straight from the tab to Google Cloud Storage.
 *
 * The audio never passes through our function: `POST /api/transcribe-upload-session`
 * returns a pre-authorized resumable session per part, and the browser PUTs the bytes to
 * Google with no Authorization header. That is what keeps Vercel's 4.5 MB body cap out of
 * the picture and keeps a service-account key out of the browser.
 *
 * Uploads run one at a time on purpose. A run is at most a couple of dozen parts, the
 * browser already pipelines a single request, and sequential PUTs give an honest progress
 * fraction — parallel ones finish in bursts, so a progress bar built on them lies about
 * how much work is left.
 */

export const UPLOAD_SESSION_PATH = '/api/transcribe-upload-session'

export interface UploadPartInput {
  /** Leaf name inside the job prefix; the server validates it. */
  name: string
  /** One of `audio/webm`, `audio/ogg`, `audio/flac`, `audio/wav`. */
  contentType: string
  blob: Blob
}

export interface UploadedPart {
  name: string
  /** `gs://…` URI, which is what `/api/transcribe-submit` expects. */
  uri: string
}

export interface UploadProgress {
  /** Parts finished so far, including the one just reported. */
  completed: number
  total: number
  name: string
}

export interface UploadPartsOptions {
  jobId: string
  parts: readonly UploadPartInput[]
  fetchImpl?: typeof fetch
  /** Overridable for tests; defaults to `UPLOAD_SESSION_PATH`. */
  sessionUrl?: string
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal
}

interface UploadSessionFile {
  name: string
  uri: string
  sessionUri: string
}

interface UploadSessionResponse {
  jobId: string
  files: UploadSessionFile[]
}

async function requestSessions(input: {
  fetchImpl: typeof fetch
  sessionUrl: string
  jobId: string
  parts: readonly UploadPartInput[]
  signal?: AbortSignal
}): Promise<UploadSessionFile[]> {
  const response = await input
    .fetchImpl(input.sessionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: input.jobId,
        files: input.parts.map((part) => ({ name: part.name, contentType: part.contentType })),
      }),
      signal: input.signal,
    })
    .catch((error: unknown) => {
      throw new Error(`upload session request failed: ${String(error)}`)
    })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`upload session refused (${response.status}): ${detail.slice(0, 200)}`)
  }

  const body = (await response.json()) as UploadSessionResponse
  if (!Array.isArray(body.files)) throw new Error('upload session response had no files')
  return body.files
}

/**
 * Index the sessions by leaf name rather than trusting order: the server builds them with
 * `Promise.all`, so nothing guarantees the array comes back in request order.
 */
function sessionsByName(files: readonly UploadSessionFile[]): Map<string, UploadSessionFile> {
  const byName = new Map<string, UploadSessionFile>()
  for (const file of files) {
    if (typeof file?.name !== 'string' || typeof file.sessionUri !== 'string') continue
    byName.set(file.name, file)
  }
  return byName
}

async function putPart(input: {
  fetchImpl: typeof fetch
  part: UploadPartInput
  session: UploadSessionFile
  signal?: AbortSignal
}): Promise<UploadedPart> {
  // Deliberately no Authorization header: the session URI is the capability, and adding a
  // bearer token here would leak one to storage.googleapis.com from the browser.
  const response = await input
    .fetchImpl(input.session.sessionUri, {
      method: 'PUT',
      headers: { 'Content-Type': input.part.contentType },
      body: input.part.blob,
      signal: input.signal,
    })
    .catch((error: unknown) => {
      throw new Error(`upload failed for ${input.part.name}: ${String(error)}`)
    })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    // A 412 here means the part already exists: the server sends `ifGenerationMatch=0` so a
    // re-upload cannot replace audio that has already been verified and submitted.
    throw new Error(
      `upload rejected for ${input.part.name} (${response.status}): ${detail.slice(0, 200)}`,
    )
  }

  return { name: input.part.name, uri: input.session.uri }
}

/** Upload every part and return the `gs://` URIs in the order they were given. */
export async function uploadParts(options: UploadPartsOptions): Promise<UploadedPart[]> {
  if (options.parts.length === 0) return []

  const fetchImpl = options.fetchImpl ?? fetch
  const sessions = sessionsByName(
    await requestSessions({
      fetchImpl,
      sessionUrl: options.sessionUrl ?? UPLOAD_SESSION_PATH,
      jobId: options.jobId,
      parts: options.parts,
      signal: options.signal,
    }),
  )

  const uploaded: UploadedPart[] = []
  for (const part of options.parts) {
    const session = sessions.get(part.name)
    // A missing session is a server bug, not a transient failure: fail loudly rather than
    // uploading the rest and letting submit discover the hole.
    if (!session) throw new Error(`no upload session issued for ${part.name}`)

    uploaded.push(await putPart({ fetchImpl, part, session, signal: options.signal }))
    options.onProgress?.({
      completed: uploaded.length,
      total: options.parts.length,
      name: part.name,
    })
  }

  return uploaded
}
