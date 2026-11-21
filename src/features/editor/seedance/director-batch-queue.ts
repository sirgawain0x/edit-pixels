import type { PixelsRenderProvider } from '@/config/pixels-render'
import type {
  DirectorBatchQuoteResponse,
  DirectorBatchQuoteShot,
  PixelsRenderQuoteLine,
} from './seedance-client'

export type DirectorBatchPath = 'allOmni' | 'allVeo' | 'allSeedance' | 'recommendedMix'

export type DirectorBatchShotStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface DirectorBatchShotJob {
  shotId: string
  requestId: string
  provider: PixelsRenderProvider
  status: DirectorBatchShotStatus
  progress: number
  error?: string
  videoUrl?: string
  mediaId?: string
  generateEndpoint: '/api/seedance-generate' | '/api/pixels-render-veo' | '/api/pixels-render-omni'
  veoTaskId?: string
}

function providerForBatchPath(
  shotRecommended: PixelsRenderProvider,
  path: DirectorBatchPath,
): PixelsRenderProvider {
  if (path === 'allOmni') return 'omni'
  if (path === 'allVeo') return 'veo'
  if (path === 'allSeedance') return 'seedance'
  return shotRecommended
}

function quoteLineForProvider(
  shot: DirectorBatchQuoteShot,
  provider: PixelsRenderProvider,
): PixelsRenderQuoteLine {
  if (provider === 'omni' && shot.omni) return shot.omni
  if (provider === 'seedance') return shot.seedance
  return shot.veo
}

function estimateFormattedUsd(
  totalUsdc6: number,
  hasAllUsdc6: boolean,
  crtvaiDisplay: number,
  quote: DirectorBatchQuoteResponse,
): string {
  if (hasAllUsdc6) {
    return `$${(totalUsdc6 / 1_000_000).toFixed(2)}`
  }
  if (quote.totals.allVeo.crtvaiDisplay > 0) {
    const usd = quote.totals.allVeo.formattedUsd.replace(/^\$/, '')
    return `$${(crtvaiDisplay * (Number.parseFloat(usd) / quote.totals.allVeo.crtvaiDisplay)).toFixed(2)}`
  }
  return '$0.00'
}

export function buildBatchSelections(
  quote: DirectorBatchQuoteResponse,
  path: DirectorBatchPath,
  perShotOverrides?: Readonly<Record<string, PixelsRenderProvider>>,
): Array<{ shotId: string; provider: PixelsRenderProvider; requestId: string }> {
  return quote.shots.map((shot) => ({
    shotId: shot.shotId,
    provider:
      perShotOverrides?.[shot.shotId] ?? providerForBatchPath(shot.recommendedProvider, path),
    requestId: crypto.randomUUID(),
  }))
}

export function totalCrtvaiForPath(
  quote: DirectorBatchQuoteResponse,
  path: DirectorBatchPath,
  perShotOverrides?: Readonly<Record<string, PixelsRenderProvider>>,
): { crtvaiRequired: string; crtvaiDisplay: number; formattedUsd: string } {
  if (!perShotOverrides || Object.keys(perShotOverrides).length === 0) {
    switch (path) {
      case 'allOmni':
        return quote.totals.allOmni ?? quote.totals.recommendedMix
      case 'allVeo':
        return quote.totals.allVeo
      case 'allSeedance':
        return quote.totals.allSeedance
      case 'recommendedMix':
        return quote.totals.recommendedMix
      default: {
        const _exhaustive: never = path
        return _exhaustive
      }
    }
  }

  let totalWei = 0n
  let totalUsdc6 = 0
  let hasAllUsdc6 = true
  for (const shot of quote.shots) {
    const provider =
      perShotOverrides[shot.shotId] ?? providerForBatchPath(shot.recommendedProvider, path)
    const line = quoteLineForProvider(shot, provider)
    totalWei += BigInt(line.crtvaiRequired)
    if (typeof line.estimatedUsdc6 === 'number') {
      totalUsdc6 += line.estimatedUsdc6
    } else {
      hasAllUsdc6 = false
    }
  }

  const crtvaiDisplay = Number(totalWei) / 1e18
  return {
    crtvaiRequired: totalWei.toString(),
    crtvaiDisplay,
    formattedUsd: estimateFormattedUsd(totalUsdc6, hasAllUsdc6, crtvaiDisplay, quote),
  }
}

export function selectShotsForRetry(jobs: DirectorBatchShotJob[]): DirectorBatchShotJob[] {
  return jobs.filter((job) => job.status === 'failed')
}

export function countBatchProgress(jobs: DirectorBatchShotJob[]): {
  completed: number
  succeeded: number
  failed: number
  total: number
} {
  const total = jobs.length
  const succeeded = jobs.filter((job) => job.status === 'succeeded').length
  const failed = jobs.filter((job) => job.status === 'failed').length
  return {
    completed: succeeded + failed,
    succeeded,
    failed,
    total,
  }
}

/**
 * Run async work over items with a fixed concurrency cap (worker-pool).
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return
  const limit = Math.max(1, Math.floor(concurrency))
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex
      nextIndex += 1
      const item = items[current]
      if (item === undefined) continue
      await worker(item)
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker())
  await Promise.all(workers)
}

export function resetFailedJobsForRetry(jobs: DirectorBatchShotJob[]): DirectorBatchShotJob[] {
  return jobs.map((job) =>
    job.status === 'failed' ? { ...job, status: 'queued', progress: 0, error: undefined } : job,
  )
}

/** After a page reload, in-flight shots should be re-enqueued (browser killed mid-poll). */
export function prepareJobsForResume(jobs: DirectorBatchShotJob[]): DirectorBatchShotJob[] {
  return jobs.map((job) =>
    job.status === 'running' ? { ...job, status: 'queued', progress: 0 } : job,
  )
}

export function isBatchQuoteExpired(expiresAt: string, nowMs = Date.now()): boolean {
  const expiresMs = new Date(expiresAt).getTime()
  return !Number.isFinite(expiresMs) || expiresMs <= nowMs
}

/** Minimum remaining TTL before we force a re-quote instead of opening the wallet. */
export const DIRECTOR_BATCH_QUOTE_LOCK_THRESHOLD_MS = 90_000

export function getBatchQuoteTimeRemainingMs(expiresAt: string, nowMs = Date.now()): number {
  const expiresMs = new Date(expiresAt).getTime()
  if (!Number.isFinite(expiresMs)) return 0
  return Math.max(0, expiresMs - nowMs)
}

export function splitQueuedJobsByProvider(jobs: readonly DirectorBatchShotJob[]): {
  seedance: DirectorBatchShotJob[]
  veo: DirectorBatchShotJob[]
  omni: DirectorBatchShotJob[]
} {
  const queued = jobs.filter((job) => job.status === 'queued')
  return {
    seedance: queued.filter((job) => job.provider === 'seedance'),
    veo: queued.filter((job) => job.provider === 'veo'),
    omni: queued.filter((job) => job.provider === 'omni'),
  }
}

/** Run Seedance, Veo, and Omni worker pools in parallel under provider-specific limits. */
export async function runBatchJobsByProvider(
  jobs: readonly DirectorBatchShotJob[],
  limits: { seedance: number; veo: number; omni?: number },
  worker: (job: DirectorBatchShotJob) => Promise<void>,
): Promise<void> {
  const { seedance, veo, omni } = splitQueuedJobsByProvider(jobs)
  await Promise.all([
    runWithConcurrency(seedance, limits.seedance, worker),
    runWithConcurrency(veo, limits.veo, worker),
    runWithConcurrency(omni, limits.omni ?? omni.length, worker),
  ])
}
