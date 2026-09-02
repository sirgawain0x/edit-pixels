// fallow-ignore-file unused-export,complexity,code-duplication
import { createLogger } from '@/shared/logging/logger'
import { quoteNanobananaCredits, quoteVeoCredits, normalizeVeoQuality } from '@/config/credits'
import type { GenerativeTaskDetail, NanobananaQuality, VeoQuality, VeoTier } from '../types'

const log = createLogger('GenerativeProxy')

export class GenerativeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'GenerativeApiError'
  }
}

export interface SignedRequestParams {
  getAccessToken: () => Promise<string | null>
  walletAddress: `0x${string}`
}

async function withAuth<T extends Record<string, unknown>>(
  params: SignedRequestParams,
  action: string,
  extra: string | undefined,
  payload: T,
): Promise<
  T & {
    action: string
    extra?: string
    timestamp: number
    requestId: string
    walletAddress: `0x${string}`
    token: string
  }
> {
  const token = await params.getAccessToken()
  if (!token) {
    throw new GenerativeApiError('Not authenticated', 401, 'not_authenticated')
  }
  return {
    ...payload,
    action,
    ...(extra ? { extra } : {}),
    timestamp: Date.now(),
    requestId: crypto.randomUUID(),
    walletAddress: params.walletAddress,
    token,
  }
}

export function isGenerativeProxyAvailable(): boolean {
  return typeof window !== 'undefined'
}

function quoteVeoCostUsdc6(params: {
  duration: number
  quality: VeoQuality
  tier: VeoTier
}): number {
  const quality = normalizeVeoQuality(params.quality, params.tier)
  const credits = quoteVeoCredits({
    duration: params.duration,
    quality,
    tier: params.tier,
  })
  return credits * 100_000
}

function quoteNanobananaCostUsdc6(quality: NanobananaQuality): number {
  return quoteNanobananaCredits(quality) * 100_000
}

/** Format USDC6 cost for display. */
function formatCostUsdc6(usdc6: number): string {
  const usd = usdc6 / 1_000_000
  return `$${usd.toFixed(2)}`
}

export async function proxySubmitVideo(
  auth: SignedRequestParams,
  body: {
    prompt: string
    image_urls: string[]
    duration?: number
    quality?: VeoQuality
    tier?: VeoTier
    /** @deprecated Use tier */
    speed?: VeoTier
    aspect_ratio?: string
    paymentTxHash?: string
  },
  signal?: AbortSignal,
): Promise<GenerativeTaskDetail & { costUsdc6?: number; crtvaiRequired?: string }> {
  const tier = body.tier ?? body.speed ?? 'standard'
  const costUsdc6 = quoteVeoCostUsdc6({
    duration: body.duration ?? 8,
    quality: body.quality ?? '720p',
    tier,
  })

  const signed = await withAuth(
    auth,
    'generate-video',
    `cost: ${formatCostUsdc6(costUsdc6)} USDC (CRTVAI)`,
    { ...body, tier } as Record<string, unknown>,
  )

  log.debug('POST /api/generate-video', { costUsdc6 })
  const { token, ...payload } = signed
  const response = await fetch('/api/generate-video', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal,
  })

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as {
      error?: string
      costUsdc6?: number
      crtvaiRequired?: string
    }
    throw new GenerativeApiError(
      errBody.error ?? `Request failed (${response.status})`,
      response.status,
      errBody.error ?? 'api_error',
    )
  }
  return (await response.json()) as GenerativeTaskDetail & {
    costUsdc6?: number
    crtvaiRequired?: string
  }
}

export async function proxySubmitImage(
  auth: SignedRequestParams,
  body: {
    prompt: string
    size?: string
    quality?: NanobananaQuality
    image_urls?: string[]
    paymentTxHash?: string
  },
  signal?: AbortSignal,
): Promise<GenerativeTaskDetail & { costUsdc6?: number; crtvaiRequired?: string }> {
  const quality = body.quality ?? '2K'
  const costUsdc6 = quoteNanobananaCostUsdc6(quality)

  const signed = await withAuth(
    auth,
    'generate-image',
    `cost: ${formatCostUsdc6(costUsdc6)} USDC (CRTVAI)`,
    body as Record<string, unknown>,
  )

  log.debug('POST /api/generate-image', { costUsdc6 })
  const { token, ...payload } = signed
  const response = await fetch('/api/generate-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal,
  })

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as { error?: string }
    throw new GenerativeApiError(
      errBody.error ?? `Request failed (${response.status})`,
      response.status,
      errBody.error ?? 'api_error',
    )
  }
  return (await response.json()) as GenerativeTaskDetail & {
    costUsdc6?: number
    crtvaiRequired?: string
  }
}

export async function proxyGetTask(
  taskId: string,
  signal?: AbortSignal,
  auth?: SignedRequestParams,
): Promise<GenerativeTaskDetail> {
  const url = new URL('/api/generate-task', window.location.origin)
  url.searchParams.set('id', taskId)
  if (auth?.walletAddress) {
    url.searchParams.set('wallet', auth.walletAddress)
  }
  const headers: Record<string, string> = {}
  if (auth) {
    const token = await auth.getAccessToken()
    if (!token) {
      throw new GenerativeApiError('Not authenticated', 401, 'not_authenticated')
    }
    headers.Authorization = `Bearer ${token}`
  }
  const response = await fetch(url.toString(), { signal, headers })
  if (!response.ok) {
    throw new GenerativeApiError(`Poll failed (${response.status})`, response.status, 'poll_error')
  }
  return (await response.json()) as GenerativeTaskDetail
}

export { quoteVeoCostUsdc6, quoteNanobananaCostUsdc6, formatCostUsdc6 }

/** @deprecated Use quoteVeoCostUsdc6 */
export const quoteSeedanceCostUsdc6 = quoteVeoCostUsdc6

export async function proxyFlowRun(
  auth: SignedRequestParams,
  body: {
    prompt: string
    duration?: number
    quality?: VeoQuality
    tier?: VeoTier
    /** @deprecated Use tier */
    speed?: VeoTier
    aspect_ratio?: string
    startImageUrl?: string
    endImageUrl?: string
    startPrompt?: string
    endPrompt?: string
    stillQuality?: NanobananaQuality
    paymentTxHash?: string
  },
  signal?: AbortSignal,
): Promise<
  GenerativeTaskDetail & {
    startImageUrl?: string
    endImageUrl?: string
    costUsdc6?: number
    crtvaiRequired?: string
  }
> {
  const tier = body.tier ?? body.speed ?? 'standard'
  const signed = await withAuth(auth, 'flow-run', undefined, {
    ...body,
    tier,
  } as Record<string, unknown>)
  const { token, ...payload } = signed
  const response = await fetch('/api/flow-run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as { error?: string }
    throw new GenerativeApiError(
      errBody.error ?? `Request failed (${response.status})`,
      response.status,
      errBody.error ?? 'api_error',
    )
  }
  return (await response.json()) as GenerativeTaskDetail & {
    startImageUrl?: string
    endImageUrl?: string
    costUsdc6?: number
    crtvaiRequired?: string
  }
}
