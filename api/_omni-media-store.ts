/// <reference types="node" />
/**
 * Temporary GCS-backed + same-origin streaming store for completed Gemini Omni MP4s.
 * Avoids Vercel's 4.5 MB JSON body cap and preserves COEP/CSP same-origin playback.
 */
// fallow-ignore-file complexity

import { randomBytes } from 'node:crypto'
import { getRedis, isRedisConfigured } from './_redis-client.js'
import { getVertexAccessToken, getVertexProject, isVertexAuthConfigured } from './_vertex-auth.js'

const MEDIA_KEY_PREFIX = 'pixels:omni:media:'
const MEDIA_TTL_SECONDS = 60 * 60 * 24 // 24 hours
const DATA_URI_FALLBACK_MAX_BYTES = 3_000_000

interface StoredGcsMediaRef {
  bucket: string
  objectName: string
  mimeType: string
}

const memoryMediaRefs = new Map<string, StoredGcsMediaRef & { expiresAt: number }>()
const memoryMediaBytes = new Map<string, { bytes: Buffer; mimeType: string; expiresAt: number }>()

function resolveOmniGcsBucket(): string {
  const configured =
    process.env.PIXELS_OMNI_GCS_BUCKET?.trim() || process.env.RENDERS_GCS_BUCKET?.trim()
  if (configured) return configured
  const project = getVertexProject()
  return project ? `${project}-creative-pixels-renders` : ''
}

function allowMemoryFallback(): boolean {
  return !process.env.VERCEL
}

function mediaUrlForToken(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/api/generate-task?media=${token}`
}

async function saveMediaRef(mediaToken: string, ref: StoredGcsMediaRef): Promise<void> {
  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      await redis.set(`${MEDIA_KEY_PREFIX}${mediaToken}`, JSON.stringify(ref), {
        ex: MEDIA_TTL_SECONDS,
      })
      return
    }
  }
  memoryMediaRefs.set(mediaToken, {
    ...ref,
    expiresAt: Date.now() + MEDIA_TTL_SECONDS * 1000,
  })
}

async function loadMediaRef(mediaToken: string): Promise<StoredGcsMediaRef | null> {
  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      const raw = await redis.get<string>(`${MEDIA_KEY_PREFIX}${mediaToken}`)
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw) as StoredGcsMediaRef
          if (parsed?.bucket && parsed?.objectName) return parsed
        } catch {
          return null
        }
      }
    }
  }
  const entry = memoryMediaRefs.get(mediaToken)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    memoryMediaRefs.delete(mediaToken)
    return null
  }
  return { bucket: entry.bucket, objectName: entry.objectName, mimeType: entry.mimeType }
}

async function tryUploadToGcs(
  bucket: string,
  objectName: string,
  bytes: Buffer,
  mimeType: string,
): Promise<boolean> {
  if (!bucket || !isVertexAuthConfigured()) return false
  try {
    const token = await getVertexAccessToken()
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mimeType,
      },
      body: new Uint8Array(bytes),
    })
    return response.ok
  } catch {
    return false
  }
}

/** Store completed Gemini Omni video bytes and return a same-origin playback URL (or small data URI). */
export async function storeOmniVideoMedia(params: {
  bytes: Buffer
  mimeType: string
  origin: string
}): Promise<string> {
  const mimeType = params.mimeType || 'video/mp4'
  const mediaToken = randomBytes(24).toString('hex')
  const bucket = resolveOmniGcsBucket()
  const objectName = `omni-media/${mediaToken}.mp4`

  const uploaded = await tryUploadToGcs(bucket, objectName, params.bytes, mimeType)
  if (uploaded) {
    await saveMediaRef(mediaToken, { bucket, objectName, mimeType })
    return mediaUrlForToken(params.origin, mediaToken)
  }

  if (allowMemoryFallback()) {
    memoryMediaBytes.set(mediaToken, {
      bytes: params.bytes,
      mimeType,
      expiresAt: Date.now() + MEDIA_TTL_SECONDS * 1000,
    })
    return mediaUrlForToken(params.origin, mediaToken)
  }

  if (params.bytes.byteLength <= DATA_URI_FALLBACK_MAX_BYTES) {
    return `data:${mimeType};base64,${params.bytes.toString('base64')}`
  }

  throw new Error('Failed to persist Gemini Omni video to GCS storage')
}

/** Stream stored Gemini Omni video bytes back to the client on same origin. */
export async function serveOmniVideoMedia(request: Request, mediaToken: string): Promise<Response> {
  const trimmed = mediaToken.trim()
  if (!/^[a-f0-9]{48}$/i.test(trimmed)) {
    return Response.json({ error: 'invalid media token' }, { status: 400 })
  }

  const memBytes = memoryMediaBytes.get(trimmed)
  if (memBytes) {
    if (memBytes.expiresAt < Date.now()) {
      memoryMediaBytes.delete(trimmed)
      return Response.json({ error: 'media expired' }, { status: 404 })
    }
    return new Response(new Uint8Array(memBytes.bytes), {
      status: 200,
      headers: {
        'Content-Type': memBytes.mimeType,
        'Content-Length': String(memBytes.bytes.byteLength),
        'Cache-Control': 'private, max-age=3600',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    })
  }

  const ref = await loadMediaRef(trimmed)
  if (!ref) {
    return Response.json({ error: 'media not found' }, { status: 404 })
  }

  const token = await getVertexAccessToken()
  const gcsUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ref.bucket)}/o/${encodeURIComponent(ref.objectName)}?alt=media`
  const forwardHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }
  const rangeHeader = request.headers.get('range')
  if (rangeHeader) {
    forwardHeaders.Range = rangeHeader
  }

  const gcsResponse = await fetch(gcsUrl, { headers: forwardHeaders })
  if (!gcsResponse.ok && gcsResponse.status !== 206) {
    return Response.json({ error: 'failed to stream media' }, { status: 502 })
  }

  const headers = new Headers()
  headers.set('Content-Type', gcsResponse.headers.get('content-type') || ref.mimeType)
  for (const copyName of ['content-length', 'content-range', 'accept-ranges']) {
    const val = gcsResponse.headers.get(copyName)
    if (val) headers.set(copyName, val)
  }
  headers.set('Cache-Control', 'private, max-age=3600')
  headers.set('Cross-Origin-Resource-Policy', 'same-origin')

  return new Response(gcsResponse.body, {
    status: gcsResponse.status,
    headers,
  })
}

export function __resetOmniMediaStoreForTest(): void {
  memoryMediaRefs.clear()
  memoryMediaBytes.clear()
}
