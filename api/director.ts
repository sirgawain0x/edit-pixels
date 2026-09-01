/// <reference types="node" />
/**
 * Vercel serverless endpoint: proxies Creative Director Agent Engine SSE.
 *
 * Engine (streamQuery SSE — not the unary :query URL):
 *   projects/creative-ai-491118/locations/us-east1/reasoningEngines/7129954674127405056
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
 *   projectId             - local workspace project id (optional, for Firestore index)
 */

import { getVertexAccessToken, getVertexLocation, getVertexProject } from './_vertex-auth'
import { assertDirectorAuthorized } from './_director-auth'
import {
  isDirectorBillingEnforced,
  quoteDirectorForWallet,
  releaseDirectorPayment,
  verifyAndConsumeDirectorPayment,
  type DirectorBillingQuote,
} from './director-billing'
import { probeAudioDurationSeconds } from './_audio-duration'
import {
  finalizeDirectorSession,
  persistDirectorPayment,
  upsertDirectorSession,
  type DirectorPersistContext,
} from './_director-firestore'
import { DirectorSsePersistAccumulator } from './_director-sse-persist'

const DEFAULT_ENGINE_ID = '7129954674127405056'

interface DirectorRequestBody {
  prompt?: string
  userId?: string
  sessionId?: string
  projectId?: string
  audioUri?: string
  audioDurationSeconds?: number
  paymentTxHash?: string
  walletAddress?: string
}

interface ParsedDirectorRequest {
  prompt: string
  userId: string
  sessionId?: string
  projectId?: string
  audioUri?: string
  audioDurationSeconds?: number
  paymentTxHash?: string
  walletAddress?: string
}

function getEngineId(): string {
  return process.env.VERTEX_REASONING_ENGINE_ID?.trim() || DEFAULT_ENGINE_ID
}

function buildMessage(prompt: string, audioUri?: string): string {
  if (!audioUri?.trim()) return prompt
  return `${prompt}\n\nAudio URI: ${audioUri.trim()}`
}

function engineStreamUrl(): string {
  const project = getVertexProject()
  const location = getVertexLocation()
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
      projectId: body.projectId?.trim(),
      audioUri: body.audioUri,
      audioDurationSeconds,
      paymentTxHash: body.paymentTxHash?.trim(),
      walletAddress: body.walletAddress?.trim(),
    },
  }
}

// fallow-ignore-next-line complexity
async function resolveBillableAudioSeconds(
  data: ParsedDirectorRequest,
): Promise<{ ok: true; seconds: number } | { ok: false; response: Response }> {
  const claimed = data.audioDurationSeconds
  if (claimed == null || claimed <= 0) {
    return {
      ok: false,
      response: Response.json(
        { error: 'audioDurationSeconds is required for Director billing' },
        { status: 402 },
      ),
    }
  }

  const audioUri = data.audioUri?.trim()
  if (!audioUri) {
    return { ok: true, seconds: claimed }
  }

  if (!/^https:\/\//i.test(audioUri)) {
    return {
      ok: false,
      response: Response.json(
        { error: 'audioUri must be an https URL when provided for Director billing' },
        { status: 402 },
      ),
    }
  }

  const measured = await probeAudioDurationSeconds(audioUri)
  if (measured == null) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Unable to verify audio duration from audioUri' },
        { status: 402 },
      ),
    }
  }

  // Reject underbilling; allow 1s client/server skew.
  if (claimed + 1 < measured) {
    return {
      ok: false,
      response: Response.json(
        {
          error: 'audioDurationSeconds understates audioUri duration',
          claimedSeconds: claimed,
          measuredSeconds: measured,
        },
        { status: 402 },
      ),
    }
  }

  return { ok: true, seconds: Math.max(claimed, measured) }
}

// fallow-ignore-next-line complexity
async function assertDirectorPayment(data: ParsedDirectorRequest): Promise<
  | { error: Response }
  | {
      paymentTxHash: string | null
      quote: DirectorBillingQuote | null
      audioSeconds: number | null
    }
> {
  if (!isDirectorBillingEnforced()) {
    return { paymentTxHash: null, quote: null, audioSeconds: null }
  }

  const billable = await resolveBillableAudioSeconds(data)
  if (!billable.ok) return { error: billable.response }

  const quote = await quoteDirectorForWallet(billable.seconds, data.walletAddress)
  if (!quote) {
    return { error: Response.json({ error: 'Unable to quote Director brief' }, { status: 402 }) }
  }

  if (!data.paymentTxHash || !data.walletAddress) {
    return {
      error: Response.json(
        {
          error: 'Director requires a CRTVAI payment before generation',
          estimatedUsdc6: quote.estimatedUsdc6,
          billableMinutes: quote.billableMinutes,
          tier: quote.tier,
        },
        { status: 402 },
      ),
    }
  }

  const verified = await verifyAndConsumeDirectorPayment({
    txHash: data.paymentTxHash,
    from: data.walletAddress,
    minAmountWei: quote.minCrtvaiWei,
    purpose: 'director',
  })

  if (!verified.ok) {
    return {
      error: Response.json(
        { error: `Director payment rejected: ${verified.reason}` },
        { status: 402 },
      ),
    }
  }

  return {
    paymentTxHash: data.paymentTxHash,
    quote,
    audioSeconds: billable.seconds,
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
  persist?: DirectorPersistContext,
): Response {
  const onClientAbort = () => upstreamAbort.abort()
  request.signal.addEventListener('abort', onClientAbort)

  const accumulator = persist ? new DirectorSsePersistAccumulator(persist.initialSessionId) : null
  const decoder = new TextDecoder()
  let persistFinalized = false

  const finalizePersist = (status: 'completed' | 'failed') => {
    if (!persist || !accumulator || persistFinalized) return
    persistFinalized = true
    accumulator.flush(decoder)
    void finalizeDirectorSession(persist, accumulator.state, status).catch((error) => {
      console.error('Director Firestore finalize failed', error)
    })
  }

  const stream = new ReadableStream<Uint8Array>({
    // fallow-ignore-next-line complexity
    async start(controller) {
      const reader = upstream.body!.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            if (accumulator) accumulator.pushChunk(value, decoder)
            controller.enqueue(value)
          }
        }
        finalizePersist(accumulator?.state.hadError ? 'failed' : 'completed')
        controller.close()
      } catch (error) {
        finalizePersist('failed')
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
      finalizePersist('failed')
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

function buildPersistContext(data: ParsedDirectorRequest): DirectorPersistContext {
  return {
    userId: data.walletAddress?.trim().toLowerCase() || data.userId,
    walletAddress: data.walletAddress,
    projectId: data.projectId,
    audioUri: data.audioUri,
    engineId: getEngineId(),
    initialSessionId: data.sessionId,
    promptPreview: data.prompt,
  }
}

// fallow-ignore-next-line complexity
export async function POST(request: Request): Promise<Response> {
  const authError = assertDirectorAuthorized(request)
  if (authError) return authError

  const parsed = await parseDirectorRequest(request)
  if (!parsed.ok) return parsed.response

  const payment = await assertDirectorPayment(parsed.data)
  if ('error' in payment) return payment.error
  const reservedPaymentTxHash = payment.paymentTxHash
  const persistCtx = buildPersistContext(parsed.data)

  if (
    payment.paymentTxHash &&
    payment.quote &&
    payment.audioSeconds != null &&
    parsed.data.walletAddress
  ) {
    void persistDirectorPayment({
      txHash: payment.paymentTxHash,
      walletAddress: parsed.data.walletAddress,
      quote: payment.quote,
      audioDurationSeconds: payment.audioSeconds,
      sessionId: parsed.data.sessionId,
      projectId: parsed.data.projectId,
    }).catch((error) => {
      console.error('Director Firestore payment persist failed', error)
    })
  }

  void upsertDirectorSession(persistCtx, 'streaming', parsed.data.sessionId).catch((error) => {
    console.error('Director Firestore session upsert failed', error)
  })

  const releaseReservedPayment = async () => {
    if (reservedPaymentTxHash) {
      await releaseDirectorPayment(reservedPaymentTxHash).catch(() => undefined)
    }
  }

  const message = buildMessage(parsed.data.prompt, parsed.data.audioUri)
  const input: Record<string, string> = { user_id: parsed.data.userId, message }
  if (parsed.data.sessionId) input.session_id = parsed.data.sessionId

  let token: string
  try {
    token = await getVertexAccessToken()
  } catch (error) {
    await releaseReservedPayment()
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
    await releaseReservedPayment()
    if (upstreamAbort.signal.aborted || request.signal.aborted) {
      return new Response(null, { status: 499 })
    }
    console.error('Director upstream fetch error', error)
    return Response.json({ error: 'Failed to reach Creative Director engine' }, { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    request.signal.removeEventListener('abort', onClientAbort)
    await releaseReservedPayment()
    const errText = await upstream.text().catch(() => '')
    console.error('Director engine error', upstream.status, errText)
    return Response.json(
      { error: 'Creative Director engine request failed', status: upstream.status },
      { status: 502 },
    )
  }

  return proxyEngineSse(request, upstream, upstreamAbort, persistCtx)
}
