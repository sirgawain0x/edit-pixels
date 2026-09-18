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

export interface SeedanceGenerateResponse {
  id: string
  status: 'completed' | 'failed'
  progress: number
  model: string
  output?: { video_url?: string }
  error?: { message?: string }
  mock?: boolean
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
    throw new Error(err.error ?? `${errorLabel} (${response.status})`)
  }
  return (await response.json()) as T
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
