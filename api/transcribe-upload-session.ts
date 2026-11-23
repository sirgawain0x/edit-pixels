/**
 * POST /api/transcribe-upload-session
 *
 * Hands the browser a pre-authorized GCS upload session per sub-file, so audio goes
 * straight from the tab to Google: no service-account key in the browser, no 4.5 MB
 * Vercel body cap, and no audio through our function at all.
 *
 * The session URI is a bearer capability, so the object name is built here from the
 * caller's own account and job — the client only chooses a leaf name.
 */
import { authenticateGenerativePost } from './_pixels-generate-route-auth.js'
import { checkPixelsRateLimits } from './_rate-limit.js'
import { createUploadSession } from './_transcribe-gcs.js'
import {
  inputPrefixFor,
  isSafePartName,
  isUploadContentType,
  transcribeBucket,
  type UploadContentType,
} from './_transcribe-uris.js'
import { readTranscriptionJob } from './_transcription-jobs.js'

/** 480 source minutes at the 20-minute sub-file wall is 24 parts; past that is a lie. */
const MAX_PARTS = 32

interface RequestedPart {
  name: string
  contentType: UploadContentType
}

export interface UploadSessionFile {
  name: string
  /** Where the object will live, which is what submit sends to Google. */
  uri: string
  /** PUT the bytes here, with no Authorization header. */
  sessionUri: string
}

export interface UploadSessionResponse {
  jobId: string
  files: UploadSessionFile[]
}

function parsePart(raw: unknown): RequestedPart | null {
  const part = (raw ?? {}) as { name?: unknown; contentType?: unknown }
  if (!isSafePartName(part.name)) return null
  if (!isUploadContentType(part.contentType)) return null
  return { name: part.name, contentType: part.contentType }
}

function parseRequest(
  body: Record<string, unknown>,
): { jobId: string; parts: RequestedPart[] } | null {
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : ''
  const rawParts = Array.isArray(body.files) ? body.files : []
  if (!jobId) return null
  if (rawParts.length === 0 || rawParts.length > MAX_PARTS) return null

  const parts: RequestedPart[] = []
  for (const raw of rawParts) {
    const part = parsePart(raw)
    if (!part) return null
    parts.push(part)
  }
  return { jobId, parts }
}

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authenticateGenerativePost(request)
  if (!authenticated.ok) return authenticated.response
  const { body, signer } = authenticated

  const identityLimited = await checkPixelsRateLimits(request, 'transcribe', {
    ip: false,
    identity: signer,
  })
  if (identityLimited) return identityLimited

  const req = parseRequest(body)
  if (!req) return Response.json({ error: 'invalid request' }, { status: 400 })

  const accountId = signer.toLowerCase()
  const job = await readTranscriptionJob(req.jobId)
  // Another account's job reads as missing, so ids cannot be probed for existence.
  if (!job || job.accountId !== accountId) {
    return Response.json({ error: 'job not found' }, { status: 404 })
  }
  // Uploads belong to a quoted job, before it is submitted. Anything later means the
  // parts already exist, and re-uploading would silently change what was submitted.
  if (job.status !== 'quoted') {
    return Response.json({ error: 'job_not_uploadable', status: job.status }, { status: 409 })
  }

  const prefix = inputPrefixFor(accountId, req.jobId)
  try {
    const files = await Promise.all(
      req.parts.map(async (part) => {
        const objectName = `${prefix}${part.name}`
        const { sessionUri } = await createUploadSession({
          objectName,
          contentType: part.contentType,
          metadata: { jobId: req.jobId, accountId },
        })
        return {
          name: part.name,
          uri: `gs://${transcribeBucket()}/${objectName}`,
          sessionUri,
        }
      }),
    )

    const response: UploadSessionResponse = { jobId: req.jobId, files }
    return Response.json(response)
  } catch (error) {
    console.error('transcription upload session failed', error)
    return Response.json({ error: 'upload_session_failed' }, { status: 502 })
  }
}
