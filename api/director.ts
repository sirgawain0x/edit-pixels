/// <reference types="node" />
/**
 * Vercel serverless endpoint: proxies Creative Director Agent Engine SSE.
 *
 * Auth: GOOGLE_SERVICE_ACCOUNT_JSON (Vercel) or Application Default Credentials
 * (local via `gcloud auth application-default login`). OAuth bearer only —
 * Agent Platform API keys are not used for :streamQuery.
 *
 * Body JSON:
 *   prompt     - user message (required)
 *   userId     - session user id (optional)
 *   sessionId  - continue an Agent Engine session (optional)
 *   audioUri   - optional audio context appended to the message
 */

import { GoogleAuth, type JWTInput } from 'google-auth-library'

const DEFAULT_PROJECT = '1037240986506'
const DEFAULT_LOCATION = 'us-central1'
const DEFAULT_ENGINE_ID = '5922098819817799680'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

interface DirectorRequestBody {
  prompt?: string
  userId?: string
  sessionId?: string
  audioUri?: string
}

function getProject(): string {
  return process.env.GOOGLE_CLOUD_PROJECT?.trim() || DEFAULT_PROJECT
}

function getLocation(): string {
  return process.env.VERTEX_LOCATION?.trim() || DEFAULT_LOCATION
}

function getEngineId(): string {
  return process.env.VERTEX_REASONING_ENGINE_ID?.trim() || DEFAULT_ENGINE_ID
}

function parseServiceAccountJson(): JWTInput | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  if (!raw) return null
  try {
    return JSON.parse(raw) as JWTInput
  } catch {
    return null
  }
}

async function getAccessToken(): Promise<string> {
  const credentials = parseServiceAccountJson()
  const auth = credentials
    ? new GoogleAuth({ credentials, scopes: [CLOUD_PLATFORM_SCOPE] })
    : new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] })

  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token
  if (!token) {
    throw new Error('Failed to obtain Google Cloud access token')
  }
  return token
}

function buildMessage(prompt: string, audioUri?: string): string {
  if (!audioUri?.trim()) return prompt
  return `${prompt}\n\nAudio URI: ${audioUri.trim()}`
}

function engineStreamUrl(): string {
  const project = getProject()
  const location = getLocation()
  const engineId = getEngineId()
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/reasoningEngines/${engineId}:streamQuery?alt=sse`
}

export async function POST(request: Request): Promise<Response> {
  let body: DirectorRequestBody
  try {
    body = (await request.json()) as DirectorRequestBody
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const prompt = body.prompt?.trim()
  if (!prompt) {
    return Response.json({ error: 'prompt is required' }, { status: 400 })
  }

  const userId = body.userId?.trim() || 'creator-user'
  const sessionId = body.sessionId?.trim()
  const message = buildMessage(prompt, body.audioUri)

  let token: string
  try {
    token = await getAccessToken()
  } catch (error) {
    console.error('Director auth error', error)
    return Response.json(
      {
        error:
          'Director not configured: set GOOGLE_SERVICE_ACCOUNT_JSON or Application Default Credentials',
      },
      { status: 503 },
    )
  }

  const input: Record<string, string> = {
    user_id: userId,
    message,
  }
  if (sessionId) {
    input.session_id = sessionId
  }

  const upstreamAbort = new AbortController()
  const onClientAbort = () => upstreamAbort.abort()
  request.signal.addEventListener('abort', onClientAbort)

  let upstream: Response
  try {
    upstream = await fetch(engineStreamUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
      },
      body: JSON.stringify({
        class_method: 'async_stream_query',
        input,
      }),
      signal: upstreamAbort.signal,
    })
  } catch (error) {
    request.signal.removeEventListener('abort', onClientAbort)
    if (upstreamAbort.signal.aborted || request.signal.aborted) {
      return new Response(null, { status: 499 })
    }
    console.error('Director upstream fetch error', error)
    return Response.json({ error: 'Failed to reach Creative Director engine' }, { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    request.signal.removeEventListener('abort', onClientAbort)
    const errText = await upstream.text().catch(() => '')
    console.error('Director engine error', upstream.status, errText)
    return Response.json(
      { error: 'Creative Director engine request failed', status: upstream.status },
      { status: 502 },
    )
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) controller.enqueue(value)
        }
        controller.close()
      } catch (error) {
        if (!upstreamAbort.signal.aborted) {
          controller.error(error)
        } else {
          controller.close()
        }
      } finally {
        request.signal.removeEventListener('abort', onClientAbort)
        reader.releaseLock()
      }
    },
    cancel() {
      upstreamAbort.abort()
      request.signal.removeEventListener('abort', onClientAbort)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
