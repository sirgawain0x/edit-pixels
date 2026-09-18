import { pollTask, proxyGetTask, type SignedRequestParams } from '@/features/editor/deps/generative'
import type { SeedanceAspectRatio } from '@/config/seedance'
import { buildDirectorPaymentOp } from '../director/build-director-payment'
import { generateSeedance, generateVeoPixels, getPixelsGenerateTask } from './seedance-client'
import type { PixelsGenerateActiveJob } from './pixels-generate-job-store'
import { savePixelsGenerateJob } from './pixels-generate-job-store'

async function confirmPixelsPayment(
  canPayOnChain: boolean,
  crtvaiRequired: string,
  sendOps: (ops: ReturnType<typeof buildDirectorPaymentOp>[]) => Promise<{ txHash: string }>,
  refreshBalance: () => void,
): Promise<string | undefined> {
  if (!canPayOnChain) return undefined
  const { txHash } = await sendOps([buildDirectorPaymentOp(BigInt(crtvaiRequired))])
  refreshBalance()
  return txHash
}

export async function pollVeoTaskToVideo(
  auth: SignedRequestParams,
  veoTaskId: string,
  options: {
    signal?: AbortSignal
    onProgress?: (pct: number) => void
    failureMessage?: string
  } = {},
): Promise<string> {
  const final = await pollTask((signal) => proxyGetTask(veoTaskId, signal, auth), {
    signal: options.signal,
    onProgress: (detail) => options.onProgress?.(Math.round(detail.progress ?? 0)),
  })
  if (final.status !== 'completed' || !final.output?.video_url) {
    throw new Error(final.error?.message || options.failureMessage || 'Veo generation failed')
  }
  return final.output.video_url
}

export async function pollSeedanceTaskToVideo(
  auth: SignedRequestParams,
  requestId: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  let polled = await getPixelsGenerateTask(auth, requestId)
  while (polled.status === 'processing') {
    onProgress?.(Math.round(polled.progress ?? 0))
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    polled = await getPixelsGenerateTask(auth, requestId)
  }
  if (polled.status !== 'completed' || !polled.output?.video_url) {
    throw new Error(polled.error?.message ?? 'Generation failed')
  }
  return polled.output.video_url
}

export async function resolveVeoTaskId(
  auth: SignedRequestParams,
  saved: PixelsGenerateActiveJob,
): Promise<{ veoTaskId: string } | { videoUrl: string }> {
  let veoTaskId = saved.veoTaskId
  for (let attempt = 0; attempt < 90; attempt++) {
    const meta = await getPixelsGenerateTask(auth, saved.requestId)
    if (meta.status === 'failed') {
      throw new Error(meta.error?.message ?? 'Veo generation failed')
    }
    if (meta.status === 'completed' && meta.output?.video_url) {
      return { videoUrl: meta.output.video_url }
    }
    veoTaskId = meta.veoTaskId ?? veoTaskId
    if (veoTaskId) return { veoTaskId }
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error('Veo task unavailable')
}

async function runSeedanceProviderGenerate(
  auth: SignedRequestParams,
  input: PixelsGenerateActiveJob,
  crtvaiRequired: string,
  seedanceQuoteId: string,
  canPayOnChain: boolean,
  sendOps: (ops: ReturnType<typeof buildDirectorPaymentOp>[]) => Promise<{ txHash: string }>,
  refreshBalance: () => void,
  signal?: AbortSignal,
): Promise<string> {
  const paymentTxHash = await confirmPixelsPayment(
    canPayOnChain,
    crtvaiRequired,
    sendOps,
    refreshBalance,
  )
  const result = await generateSeedance(
    auth,
    {
      prompt: input.brief.prompt,
      duration: input.brief.duration,
      resolution: input.resolution,
      aspect_ratio: (input.brief.aspect_ratio as SeedanceAspectRatio) || '16:9',
      quoteId: seedanceQuoteId,
      requestId: input.requestId,
      ...(paymentTxHash ? { paymentTxHash } : {}),
    },
    signal,
  )
  if (result.status !== 'completed' || !result.output?.video_url) {
    throw new Error(result.error?.message ?? 'Generation failed')
  }
  return result.output.video_url
}

async function runVeoProviderGenerate(
  auth: SignedRequestParams,
  input: PixelsGenerateActiveJob,
  crtvaiRequired: string,
  canPayOnChain: boolean,
  sendOps: (ops: ReturnType<typeof buildDirectorPaymentOp>[]) => Promise<{ txHash: string }>,
  refreshBalance: () => void,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  let veoTaskId = input.veoTaskId
  if (!veoTaskId) {
    const paymentTxHash = await confirmPixelsPayment(
      canPayOnChain,
      crtvaiRequired,
      sendOps,
      refreshBalance,
    )
    const started = await generateVeoPixels(
      auth,
      {
        prompt: input.brief.prompt,
        duration: input.brief.duration,
        aspect_ratio: input.brief.aspect_ratio,
        requestId: input.requestId,
        ...(paymentTxHash ? { paymentTxHash } : {}),
      },
      signal,
    )
    veoTaskId = started.id
    savePixelsGenerateJob({ ...input, veoTaskId })
  }
  return pollVeoTaskToVideo(auth, veoTaskId, { signal, onProgress })
}

export async function runProviderGenerate(
  auth: SignedRequestParams,
  input: PixelsGenerateActiveJob,
  crtvaiRequired: string,
  options: {
    canPayOnChain: boolean
    sendOps: (ops: ReturnType<typeof buildDirectorPaymentOp>[]) => Promise<{ txHash: string }>
    refreshBalance: () => void
    onProgress: (pct: number) => void
    seedanceQuoteId?: string
    signal?: AbortSignal
  },
): Promise<string> {
  if (input.provider === 'seedance') {
    if (!options.seedanceQuoteId) throw new Error('Seedance quote unavailable')
    return runSeedanceProviderGenerate(
      auth,
      input,
      crtvaiRequired,
      options.seedanceQuoteId,
      options.canPayOnChain,
      options.sendOps,
      options.refreshBalance,
      options.signal,
    )
  }
  return runVeoProviderGenerate(
    auth,
    input,
    crtvaiRequired,
    options.canPayOnChain,
    options.sendOps,
    options.refreshBalance,
    options.onProgress,
    options.signal,
  )
}
