// fallow-ignore-file unused-export

import { createLogger } from '@/shared/logging/logger'
import type { SeedanceAspectRatio, SeedanceResolution } from '@/config/seedance'
import type { PixelsRenderProvider } from '@/config/pixels-render'
import type { GenerativeTaskDetail, SignedRequestParams } from '@/features/editor/deps/generative'

const log = createLogger('SeedanceClient')

export interface SeedanceShotBrief {
  prompt: string
  duration: number
  aspect_ratio: string
  framing: string
}

export interface SeedanceQuoteResponse {
  quoteId: string
  duration: number
  resolution: SeedanceResolution
  estimatedUsdc6: number
  crtvaiRequired: string
  crtvaiDisplay: number
  formattedUsd: string
}

export interface PixelsRenderQuoteLine {
  provider: PixelsRenderProvider
  duration: number
  estimatedUsdc6: number
  crtvaiRequired: string
  crtvaiDisplay: number
  formattedUsd: string
  label: string
  detail: string
  quoteId?: string
  resolution?: SeedanceResolution
  stillCount?: number
}

export interface PixelsRenderQuotesResponse {
  veo: PixelsRenderQuoteLine
  seedance: PixelsRenderQuoteLine & { quoteId: string }
}

export type SeedanceGenerateStatus = 'processing' | 'completed' | 'failed' | 'cancelled'

export interface SeedanceGenerateResponse {
  id: string
  status: SeedanceGenerateStatus
  progress: number
  model: string
  veoTaskId?: string
  output?: { video_url?: string }
  error?: { code?: string; message?: string; type?: string }
  mock?: boolean
  costUsdc6?: number
  crtvaiRequired?: string
}

export class PixelsGenerateApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'PixelsGenerateApiError'
    this.code = code
    this.status = status
  }
}

async function withAuth<T extends Record<string, unknown>>(
  params: SignedRequestParams,
  payload: T,
): Promise<T & { walletAddress: `0x${string}`; token: string }> {
  const token = await params.getAccessToken()
  if (!token) {
    throw new Error('Not authenticated')
  }
  return {
    ...payload,
    walletAddress: params.walletAddress,
    token,
  }
}

// fallow-ignore-next-line complexity
function parseApiError(
  status: number,
  body: { error?: string; balance?: string; requiredMetoken?: string },
  fallback: string,
): PixelsGenerateApiError {
  const code = body.error ?? fallback
  if (code === 'insufficient_crtvai') {
    return new PixelsGenerateApiError(
      code,
      'Insufficient CRTVAI for this generation.',
      status,
    )
  }
  if (code === 'payment_required') {
    return new PixelsGenerateApiError(code, 'Payment is required before generating.', status)
  }
  if (code === 'quote_mismatch') {
    return new PixelsGenerateApiError(
      code,
      'Quote expired — re-plan and pick a provider again.',
      status,
    )
  }
  if (code === 'batch_shot_already_started') {
    return new PixelsGenerateApiError(
      code,
      'This shot is already rendering — polling existing job.',
      status,
    )
  }
  if (code === 'quote_already_confirmed') {
    return new PixelsGenerateApiError(
      code,
      'This batch quote was already confirmed — refresh to resume rendering.',
      status,
    )
  }
  if (code === 'selection_mismatch') {
    return new PixelsGenerateApiError(
      code,
      'Shot selection does not match the batch quote — refresh the quote.',
      status,
    )
  }
  if (code === 'quote_not_found' || code === 'quote_expired') {
    return new PixelsGenerateApiError(
      code,
      'Batch quote expired — refresh the quote before paying.',
      status,
    )
  }
  return new PixelsGenerateApiError(code, code, status)
}

async function postSeedanceApi<T>(
  path: string,
  auth: SignedRequestParams,
  body: Record<string, unknown>,
  errorLabel: string,
  signal?: AbortSignal,
): Promise<T> {
  const signed = await withAuth(auth, body)
  const { token, ...payload } = signed
  log.debug(`POST ${path}`)
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string }
    throw parseApiError(response.status, err, `${errorLabel} (${response.status})`)
  }
  return (await response.json()) as T
}

export async function getPixelsGenerateTask(
  auth: SignedRequestParams,
  taskId: string,
  signal?: AbortSignal,
): Promise<SeedanceGenerateResponse> {
  const token = await auth.getAccessToken()
  if (!token) {
    throw new Error('Not authenticated')
  }
  const params = new URLSearchParams({
    id: taskId,
    wallet: auth.walletAddress,
  })
  const response = await fetch(`/api/pixels-generate-task?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string }
    throw parseApiError(response.status, err, `Task poll failed (${response.status})`)
  }
  return (await response.json()) as SeedanceGenerateResponse
}

export async function planSeedanceShot(
  auth: SignedRequestParams,
  body: { idea: string; timelineContext?: string },
): Promise<SeedanceShotBrief> {
  const data = await postSeedanceApi<{ brief: SeedanceShotBrief }>(
    '/api/seedance-plan',
    auth,
    body,
    'Planning failed',
  )
  return data.brief
}

export async function quoteSeedance(
  auth: SignedRequestParams,
  body: { duration: number; resolution: SeedanceResolution },
): Promise<SeedanceQuoteResponse> {
  return postSeedanceApi<SeedanceQuoteResponse>('/api/seedance-quote', auth, body, 'Quote failed')
}

export async function quotePixelsRender(
  auth: SignedRequestParams,
  body: { duration: number; resolution: SeedanceResolution },
): Promise<PixelsRenderQuotesResponse> {
  return postSeedanceApi<PixelsRenderQuotesResponse>(
    '/api/pixels-render-quote',
    auth,
    body,
    'Quote failed',
  )
}

export async function generateVeoPixels(
  auth: SignedRequestParams,
  body: {
    prompt: string
    duration: number
    aspect_ratio: string
    requestId: string
    paymentTxHash?: string
  },
  signal?: AbortSignal,
): Promise<GenerativeTaskDetail> {
  return postSeedanceApi<GenerativeTaskDetail>(
    '/api/pixels-render-veo',
    auth,
    body,
    'Veo render failed',
    signal,
  )
}

export async function cancelPixelsGenerate(
  auth: SignedRequestParams,
  requestId: string,
): Promise<{ id: string; status: string; paymentReleased: boolean }> {
  return postSeedanceApi<{ id: string; status: string; paymentReleased: boolean }>(
    '/api/pixels-generate-cancel',
    auth,
    { requestId },
    'Cancel failed',
  )
}

export interface DirectorStoryboardShotPayload {
  shotId: string
  prompt: string
  duration?: number
  aspectRatio?: string
  consistentCharacter?: boolean
  resolution?: SeedanceResolution
}

export interface DirectorBatchQuoteShot {
  shotId: string
  recommendedProvider: PixelsRenderProvider
  generate: {
    prompt: string
    duration: number
    veoDuration: number
    seedanceDuration: number
    aspect_ratio: string
    resolution: SeedanceResolution
  }
  veo: PixelsRenderQuoteLine
  seedance: PixelsRenderQuoteLine & { quoteId: string }
}

export interface DirectorBatchQuoteResponse {
  batchQuoteId: string
  expiresAt: string
  shotCount: number
  shots: DirectorBatchQuoteShot[]
  totals: {
    allVeo: { crtvaiRequired: string; crtvaiDisplay: number; formattedUsd: string }
    allSeedance: { crtvaiRequired: string; crtvaiDisplay: number; formattedUsd: string }
    recommendedMix: {
      crtvaiRequired: string
      crtvaiDisplay: number
      formattedUsd: string
      providers: { veo: number; seedance: number }
    }
  }
}

export interface DirectorBatchConfirmJob {
  shotId: string
  requestId: string
  provider: PixelsRenderProvider
  status: 'queued'
  seedanceQuoteId: string | null
  crtvaiRequired: string
  pollUrl: string
  generateEndpoint: '/api/seedance-generate' | '/api/pixels-render-veo'
}

export interface DirectorBatchConfirmResponse {
  batchConfirmId: string
  batchQuoteId: string
  paymentTxHash: string | null
  totalCrtvaiRequired: string
  totalCrtvaiDisplay: number
  jobs: DirectorBatchConfirmJob[]
  enqueue: {
    note: string
    batchConfirmId: string
  }
}

export async function quoteDirectorBatch(
  auth: SignedRequestParams,
  body: {
    shots: DirectorStoryboardShotPayload[]
    providerPreference?: PixelsRenderProvider
    storyboardId?: string
    resolution?: SeedanceResolution
  },
): Promise<DirectorBatchQuoteResponse> {
  return postSeedanceApi<DirectorBatchQuoteResponse>(
    '/api/pixels-director-batch-quote',
    auth,
    body,
    'Batch quote failed',
  )
}

export async function confirmDirectorBatch(
  auth: SignedRequestParams,
  body: {
    batchQuoteId: string
    selections: Array<{ shotId: string; provider: PixelsRenderProvider; requestId: string }>
    paymentTxHash?: string
  },
): Promise<DirectorBatchConfirmResponse> {
  return postSeedanceApi<DirectorBatchConfirmResponse>(
    '/api/pixels-director-batch-confirm',
    auth,
    body,
    'Batch confirm failed',
  )
}

export interface DirectorBatchEnqueueResponse {
  id?: string
  status?: string
  progress?: number
  veoTaskId?: string
  output?: { video_url?: string }
  error?: { code?: string; message?: string; type?: string }
}

export async function enqueueDirectorBatchShot(
  auth: SignedRequestParams,
  endpoint: '/api/seedance-generate' | '/api/pixels-render-veo',
  body: {
    batchConfirmId: string
    shotId: string
    requestId: string
  },
  signal?: AbortSignal,
): Promise<DirectorBatchEnqueueResponse> {
  return postSeedanceApi<DirectorBatchEnqueueResponse>(
    endpoint,
    auth,
    body,
    'Batch enqueue failed',
    signal,
  )
}

export async function generateSeedance(
  auth: SignedRequestParams,
  body: {
    prompt: string
    duration: number
    resolution: SeedanceResolution
    aspect_ratio: SeedanceAspectRatio
    quoteId: string
    requestId: string
    paymentTxHash?: string
    generate_audio?: boolean
  },
  signal?: AbortSignal,
): Promise<SeedanceGenerateResponse> {
  return postSeedanceApi<SeedanceGenerateResponse>(
    '/api/seedance-generate',
    auth,
    body,
    'Generation failed',
    signal,
  )
}
