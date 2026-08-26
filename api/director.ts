/// <reference types="node" />
/**
 * Vercel serverless endpoint: proxies Creative Director Agent Engine SSE.
 *
 * Auth (no service-account keys):
 * - Production / Vercel: Workload Identity Federation via Vercel OIDC
 *   (`@vercel/oidc` + `ExternalAccountClient`)
 * - Local: Application Default Credentials
 *   (`gcloud auth application-default login`), or the same WIF path after
 *   `vercel env pull` (provides `VERCEL_OIDC_TOKEN`)
 *
 * Body JSON:
 *   prompt     - user message (required)
 *   userId     - session user id (optional)
 *   sessionId  - continue an Agent Engine session (optional)
 *   audioUri   - optional audio context appended to the message
 */

import { getVercelOidcToken } from '@vercel/oidc'
import { ExternalAccountClient, GoogleAuth } from 'google-auth-library'

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

interface WifConfig {
  projectNumber: string
  poolId: string
  providerId: string
  serviceAccountEmail: string
  audience: string
}

function getProject(): string {
  return (
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCP_PROJECT_ID?.trim() ||
    DEFAULT_PROJECT
  )
}

function getLocation(): string {
  return process.env.VERTEX_LOCATION?.trim() || DEFAULT_LOCATION
}

function getEngineId(): string {
  return process.env.VERTEX_REASONING_ENGINE_ID?.trim() || DEFAULT_ENGINE_ID
}

// fallow-ignore-next-line complexity
function readWifConfig(): WifConfig | null {
  const projectNumber = process.env.GCP_PROJECT_NUMBER?.trim()
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID?.trim()
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID?.trim()
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL?.trim()
  if (!projectNumber || !poolId || !providerId || !serviceAccountEmail) {
    return null
  }

  // Prefer GCP_AUDIENCE from the provider details page (Default audience).
  // Format: https://iam.googleapis.com/projects/.../providers/...
  // See https://vercel.com/docs/oidc/gcp
  const audience =
    process.env.GCP_AUDIENCE?.trim() ||
    `https://iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`

  return { projectNumber, poolId, providerId, serviceAccountEmail, audience }
}

// fallow-ignore-next-line complexity
function tokenFromResponse(tokenResponse: unknown): string | null {
  if (typeof tokenResponse === 'string' && tokenResponse) return tokenResponse
  if (
    tokenResponse &&
    typeof tokenResponse === 'object' &&
    'token' in tokenResponse &&
    typeof (tokenResponse as { token?: unknown }).token === 'string'
  ) {
    return (tokenResponse as { token: string }).token
  }
  return null
}

async function getAccessTokenViaWif(config: WifConfig): Promise<string> {
  // Custom audience pattern (Vercel + GCP recommended):
  // - ExternalAccountClient.audience = provider Default audience (https://iam.googleapis.com/...)
  // - getVercelOidcToken({ audience }) so the OIDC aud claim matches that provider
  const client = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: config.audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: () =>
        getVercelOidcToken({
          audience: config.audience,
        }),
    },
  })

  if (!client) {
    throw new Error('Failed to create Workload Identity Federation client')
  }

  client.scopes = [CLOUD_PLATFORM_SCOPE]
  const token = tokenFromResponse(await client.getAccessToken())
  if (!token) {
    throw new Error('Failed to obtain access token via Workload Identity Federation')
  }
  return token
}

async function getAccessTokenViaAdc(): Promise<string> {
  const auth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] })
  const client = await auth.getClient()
  const token = tokenFromResponse(await client.getAccessToken())
  if (!token) {
    throw new Error('Failed to obtain Google Cloud access token via ADC')
  }
  return token
}

/**
 * Prefer keyless WIF on Vercel; fall back to ADC for local shells without OIDC.
 */
async function getAccessToken(): Promise<string> {
  const wif = readWifConfig()
  if (wif) {
    return getAccessTokenViaWif(wif)
  }
  return getAccessTokenViaAdc()
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

async function parseDirectorRequest(
  request: Request,
): Promise<
  | { ok: true; prompt: string; userId: string; sessionId?: string; audioUri?: string }
  | { ok: false; response: Response }
> {
  let body: DirectorRequestBody
  try {
    body = (await request.json()) as DirectorRequestBody
  } catch {
    return { ok: false, response: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  }

  const prompt = body.prompt?.trim()
  if (!prompt) {
    return { ok: false, response: Response.json({ error: 'prompt is required' }, { status: 400 }) }
  }

  return {
    ok: true,
    prompt,
    userId: body.userId?.trim() || 'creator-user',
    sessionId: body.sessionId?.trim(),
    audioUri: body.audioUri,
  }
}

async function fetchEngineStream(
  token: string,
  input: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(engineStreamUrl(), {
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
    signal,
  })
}

function proxyEngineSse(
  request: Request,
  upstream: Response,
  upstreamAbort: AbortController,
): Response {
  const onClientAbort = () => upstreamAbort.abort()
  request.signal.addEventListener('abort', onClientAbort)

  const stream = new ReadableStream<Uint8Array>({
    // fallow-ignore-next-line complexity
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

// fallow-ignore-next-line complexity
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseDirectorRequest(request)
  if (!parsed.ok) return parsed.response

  const message = buildMessage(parsed.prompt, parsed.audioUri)
  const input: Record<string, string> = { user_id: parsed.userId, message }
  if (parsed.sessionId) input.session_id = parsed.sessionId

  let token: string
  try {
    token = await getAccessToken()
  } catch (error) {
    console.error('Director auth error', error)
    return Response.json(
      {
        error:
          'Director not configured: set GCP Workload Identity Federation env vars (Vercel OIDC) or Application Default Credentials locally',
      },
      { status: 503 },
    )
  }

  const upstreamAbort = new AbortController()
  const onClientAbort = () => upstreamAbort.abort()
  request.signal.addEventListener('abort', onClientAbort)

  let upstream: Response
  try {
    upstream = await fetchEngineStream(token, input, upstreamAbort.signal)
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

  return proxyEngineSse(request, upstream, upstreamAbort)
}
