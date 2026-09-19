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
