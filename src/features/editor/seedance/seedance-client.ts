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

export async function planSeedanceShot(
  auth: SignedRequestParams,
  body: { idea: string; timelineContext?: string },
): Promise<SeedanceShotBrief> {
  const signed = await withAuth(auth, body)
  const { token, ...payload } = signed
  log.debug('POST /api/seedance-plan')
  const response = await fetch('/api/seedance-plan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `Planning failed (${response.status})`)
  }
  const data = (await response.json()) as { brief: SeedanceShotBrief }
  return data.brief
}

export async function quoteSeedance(
  auth: SignedRequestParams,
  body: { duration: number; resolution: SeedanceResolution },
): Promise<SeedanceQuoteResponse> {
  const signed = await withAuth(auth, body)
  const { token, ...payload } = signed
  log.debug('POST /api/seedance-quote')
  const response = await fetch('/api/seedance-quote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `Quote failed (${response.status})`)
  }
  return (await response.json()) as SeedanceQuoteResponse
}

export async function quotePixelsRender(
  auth: SignedRequestParams,
  body: { duration: number; resolution: SeedanceResolution },
): Promise<PixelsRenderQuotesResponse> {
  const signed = await withAuth(auth, body)
  const { token, ...payload } = signed
  log.debug('POST /api/pixels-render-quote')
  const response = await fetch('/api/pixels-render-quote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `Quote failed (${response.status})`)
  }
  return (await response.json()) as PixelsRenderQuotesResponse
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
  const signed = await withAuth(auth, body)
  const { token, ...payload } = signed
  log.debug('POST /api/pixels-render-veo')
  const response = await fetch('/api/pixels-render-veo', {
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
    throw new Error(err.error ?? `Veo render failed (${response.status})`)
  }
  return (await response.json()) as GenerativeTaskDetail
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
  const signed = await withAuth(auth, body)
  const { token, ...payload } = signed
  log.debug('POST /api/seedance-generate')
  const response = await fetch('/api/seedance-generate', {
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
    throw new Error(err.error ?? `Generation failed (${response.status})`)
  }
  return (await response.json()) as SeedanceGenerateResponse
}
