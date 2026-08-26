/**
 * Temporary public image hosting for Flow frames (Evolink needs HTTPS URLs).
 *
 * POST /api/flow-frame — auth required; body multipart or JSON { dataUri, contentType? }
 * GET  /api/flow-frame?id=... — public read for Evolink fetch (unguessable id)
 */
// fallow-ignore-file complexity,code-duplication

import { randomBytes } from 'node:crypto'
import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { getRedis, isRedisConfigured } from './_redis-client.js'

const FRAME_KEY_PREFIX = 'pixels:flow:frame:'
const FRAME_TTL_SECONDS = 60 * 60 // 1 hour
const MAX_BYTES = 8 * 1024 * 1024

/** Local-dev only — Vercel serverless instances do not share memory. */
const memoryFrames = new Map<
  string,
  { bytes: Uint8Array; contentType: string; expiresAt: number }
>()

function allowMemoryFallback(): boolean {
  return !process.env.VERCEL
}

function parseDataUri(dataUri: string): { contentType: string; bytes: Uint8Array } {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(dataUri.trim())
  if (!match) throw new Error('Invalid data URI')
  const contentType = match[1] || 'application/octet-stream'
  const isBase64 = Boolean(match[2])
  const payload = match[3] || ''
  const bytes = isBase64
    ? Uint8Array.from(Buffer.from(payload, 'base64'))
    : new TextEncoder().encode(decodeURIComponent(payload))
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    throw new Error('Image too large or empty')
  }
  return { contentType, bytes }
}

async function storeFrame(contentType: string, bytes: Uint8Array): Promise<string> {
  const id = randomBytes(24).toString('hex')
  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      await redis.set(
        `${FRAME_KEY_PREFIX}${id}`,
        JSON.stringify({
          contentType,
          b64: Buffer.from(bytes).toString('base64'),
        }),
        { ex: FRAME_TTL_SECONDS },
      )
      return id
    }
  }

  if (!allowMemoryFallback()) {
    throw new Error('Frame store unavailable (configure Upstash/Vercel KV)')
  }

  memoryFrames.set(id, {
    contentType,
    bytes,
    expiresAt: Date.now() + FRAME_TTL_SECONDS * 1000,
  })
  return id
}

async function loadFrame(id: string): Promise<{ contentType: string; bytes: Uint8Array } | null> {
  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      const raw = await redis.get<string>(`${FRAME_KEY_PREFIX}${id}`)
      if (!raw || typeof raw !== 'string') return null
      try {
        const parsed = JSON.parse(raw) as { contentType?: string; b64?: string }
        if (!parsed.b64) return null
        return {
          contentType: parsed.contentType || 'application/octet-stream',
          bytes: Uint8Array.from(Buffer.from(parsed.b64, 'base64')),
        }
      } catch {
        return null
      }
    }
  }

  if (!allowMemoryFallback()) return null

  const entry = memoryFrames.get(id)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    memoryFrames.delete(id)
    return null
  }
  return { contentType: entry.contentType, bytes: entry.bytes }
}

/** Used by flow-run when the client still sends a data URI. */
export async function storeFlowFrameFromDataUri(dataUri: string, origin: string): Promise<string> {
  const { contentType, bytes } = parseDataUri(dataUri)
  const id = await storeFrame(contentType, bytes)
  return `${origin.replace(/\/$/, '')}/api/flow-frame?id=${id}`
}

export async function POST(request: Request): Promise<Response> {
  const token = getBearerToken(request)
  if (!token) {
    return Response.json({ error: 'missing authorization' }, { status: 401 })
  }

  let body: Record<string, unknown>
  const contentTypeHeader = request.headers.get('content-type') || ''
  try {
    if (contentTypeHeader.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      const walletAddress =
        typeof form.get('walletAddress') === 'string'
          ? String(form.get('walletAddress'))
          : undefined
      const auth = await verifyPrivyAccessToken(token, walletAddress)
      if (!auth) {
        return Response.json({ error: 'invalid authorization' }, { status: 401 })
      }
      if (!(file instanceof File)) {
        return Response.json({ error: 'file required' }, { status: 400 })
      }
      const buf = new Uint8Array(await file.arrayBuffer())
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
        return Response.json({ error: 'invalid file size' }, { status: 400 })
      }
      const id = await storeFrame(file.type || 'application/octet-stream', buf)
      const origin = new URL(request.url).origin
      return Response.json({
        id,
        url: `${origin}/api/flow-frame?id=${id}`,
      })
    }

    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const auth = await verifyPrivyAccessToken(
    token,
    typeof body.walletAddress === 'string' ? body.walletAddress : undefined,
  )
  if (!auth) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 })
  }

  const dataUri = typeof body.dataUri === 'string' ? body.dataUri : ''
  if (!dataUri.startsWith('data:')) {
    return Response.json({ error: 'dataUri required' }, { status: 400 })
  }

  try {
    const origin = new URL(request.url).origin
    const url = await storeFlowFrameFromDataUri(dataUri, origin)
    return Response.json({ url, id: new URL(url).searchParams.get('id') })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'upload failed' },
      { status: 400 },
    )
  }
}

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id')?.trim()
  if (!id || !/^[a-f0-9]{32,64}$/i.test(id)) {
    return Response.json({ error: 'id required' }, { status: 400 })
  }

  const frame = await loadFrame(id)
  if (!frame) {
    return Response.json({ error: 'not found' }, { status: 404 })
  }

  return new Response(Buffer.from(frame.bytes), {
    status: 200,
    headers: {
      'Content-Type': frame.contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
