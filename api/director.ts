/// <reference types="node" />
/**
 * Vercel serverless endpoint: proxies Creative Director Agent Engine SSE.
 *
 * Engine (streamQuery SSE — not the unary :query URL):
 *   projects/creative-ai-491118/locations/us-central1/reasoningEngines/5922098819817799680
 * Agent runtime identity (Agent Engine SA — not the caller):
 *   service-1037240986506@gcp-sa-aiplatform-re.iam.gserviceaccount.com
 *
 * Auth (no service-account keys):
 * - Production / Vercel: Workload Identity Federation via Vercel OIDC
 *   (`@vercel/oidc` + `ExternalAccountClient`)
 * - Local: Application Default Credentials
 *   (`gcloud auth application-default login`); GCP_* from `vercel env pull`
 *   only apply when `VERCEL` is set
 *
 * Body JSON:
 *   prompt                - user message (required)
 *   userId                - session user id (optional)
 *   sessionId             - continue an Agent Engine session (optional)
 *   audioUri              - optional audio context appended to the message
 *   audioDurationSeconds  - timeline audio length (required when billing enforced)
 *   paymentTxHash         - CRTVAI transfer to treasury (required when billing enforced)
 *   walletAddress         - payer wallet (required when billing enforced)
 */

import { getVercelOidcToken } from '@vercel/oidc'
import { ExternalAccountClient, GoogleAuth } from 'google-auth-library'
import {
  isDirectorBillingEnforced,
  quoteDirectorForWallet,
  verifyAndConsumeDirectorPayment,
} from './director-billing'

const DEFAULT_PROJECT = 'creative-ai-491118'
const DEFAULT_LOCATION = 'us-central1'
const DEFAULT_ENGINE_ID = '5922098819817799680'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

interface DirectorRequestBody {
  prompt?: string
  userId?: string
  sessionId?: string
  audioUri?: string
  audioDurationSeconds?: number
  paymentTxHash?: string
  walletAddress?: string
}

interface ParsedDirectorRequest {
  prompt: string
  userId: string
  sessionId?: string
  audioUri?: string
  audioDurationSeconds?: number
  paymentTxHash?: string
  walletAddress?: string
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
 * Prefer keyless WIF on Vercel; use ADC for local `vp dev`.
 *
 * `vercel env pull` often copies GCP_* into `.env.local`. Those must not force
 * the WIF path locally — Vercel OIDC tokens expire and `@vercel/oidc` needs the
 * Vercel runtime. Only use WIF when `VERCEL` is set.
 */
async function getAccessToken(): Promise<string> {
  const wif = readWifConfig()
  if (wif && process.env.VERCEL) {
    return getAccessTokenViaWif(wif)
  }
  return getAccessTokenViaAdc()
}

function buildMessage(prompt: string, audioUri?: string): string {
  if (!audioUri?.trim()) return prompt
  return `${prompt}\n\nAudio URI: ${audioUri.trim()}`
}

// fallow-ignore-next-line complexity
function normalizeHost(value: string | null): string | null {
  if (!value) return null
  try {
    if (value.includes('://')) {
      return new URL(value).host.split(':')[0]?.toLowerCase() ?? null
    }
    return value.split(':')[0]?.toLowerCase() ?? null
  } catch {
    return null
  }
}

/**
 * Block unauthenticated abuse of the Vertex proxy on Vercel.
 * - Production: same-origin browser requests, or DIRECTOR_API_SECRET bearer/header
 * - Local dev: open (no VERCEL env)
 */
// fallow-ignore-next-line complexity
function assertDirectorAuthorized(request: Request): Response | null {
  const secret = process.env.DIRECTOR_API_SECRET?.trim()
  if (secret) {
    const auth = request.headers.get('authorization')
    const headerSecret = request.headers.get('x-director-secret')
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null
    if (bearer === secret || headerSecret === secret) {
      return null
    }
  }

  if (process.env.VERCEL) {
    const host = normalizeHost(request.headers.get('host'))
    const originHost = normalizeHost(request.headers.get('origin'))
    const refererHost = normalizeHost(request.headers.get('referer'))
    if (host && (originHost === host || refererHost === host)) {
      return null
    }
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}

function engineStreamUrl(): string {
  const project = getProject()
  const location = getLocation()
  const engineId = getEngineId()
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/reasoningEngines/${engineId}:streamQuery?alt=sse`
}

// fallow-ignore-next-line complexity
async function parseDirectorRequest(
  request: Request,
): Promise<{ ok: true; data: ParsedDirectorRequest } | { ok: false; response: Response }> {
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

  const audioDurationSeconds =
    typeof body.audioDurationSeconds === 'number' && Number.isFinite(body.audioDurationSeconds)
      ? body.audioDurationSeconds
      : undefined

  return {
    ok: true,
    data: {
      prompt,
      userId: body.userId?.trim() || 'creator-user',
      sessionId: body.sessionId?.trim(),
      audioUri: body.audioUri,
      audioDurationSeconds,
      paymentTxHash: body.paymentTxHash?.trim(),
      walletAddress: body.walletAddress?.trim(),
    },
  }
}

// fallow-ignore-next-line complexity
async function assertDirectorPayment(data: ParsedDirectorRequest): Promise<Response | null> {
  if (!isDirectorBillingEnforced()) return null

  if (data.audioDurationSeconds == null || data.audioDurationSeconds <= 0) {
    return Response.json(
      { error: 'audioDurationSeconds is required for Director billing' },
      { status: 402 },
    )
  }

  const quote = await quoteDirectorForWallet(data.audioDurationSeconds, data.walletAddress)
  if (!quote) {
    return Response.json({ error: 'Unable to quote Director brief' }, { status: 402 })
  }

  if (!data.paymentTxHash || !data.walletAddress) {
    return Response.json(
      {
        error: 'Director requires a CRTVAI payment before generation',
        estimatedUsdc6: quote.estimatedUsdc6,
        billableMinutes: quote.billableMinutes,
        tier: quote.tier,
      },
      { status: 402 },
    )
  }

  const verified = await verifyAndConsumeDirectorPayment({
    txHash: data.paymentTxHash,
    from: data.walletAddress,
    minAmountWei: quote.minCrtvaiWei,
    purpose: 'director',
  })

  if (!verified.ok) {
    return Response.json(
      { error: `Director payment rejected: ${verified.reason}` },
      { status: 402 },
    )
  }

  return null
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
  const authError = assertDirectorAuthorized(request)
  if (authError) return authError

  const parsed = await parseDirectorRequest(request)
  if (!parsed.ok) return parsed.response

  const paymentError = await assertDirectorPayment(parsed.data)
  if (paymentError) return paymentError

  const message = buildMessage(parsed.data.prompt, parsed.data.audioUri)
  const input: Record<string, string> = { user_id: parsed.data.userId, message }
  if (parsed.data.sessionId) input.session_id = parsed.data.sessionId

  let token: string
  try {
    token = await getAccessToken()
  } catch (error) {
    console.error('Director auth error', error)
    const detail = error instanceof Error ? error.message : String(error)
    const hint = process.env.VERCEL
      ? 'Set GCP Workload Identity Federation env vars (Vercel OIDC).'
      : 'Run `gcloud auth application-default login` (local ADC). GCP_* from `vercel env pull` are ignored off-Vercel.'
    return Response.json(
      {
        error: `Director auth failed: ${hint}`,
        detail: process.env.VERCEL ? undefined : detail,
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
