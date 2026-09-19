import type { PixelsRenderProvider } from '@/config/pixels-render'
import type { DirectorBatchQuoteResponse } from './seedance-client'

export type DirectorBatchPath = 'allVeo' | 'allSeedance' | 'recommendedMix'

export type DirectorBatchShotStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface DirectorBatchShotJob {
  shotId: string
  requestId: string
  provider: PixelsRenderProvider
  status: DirectorBatchShotStatus
  progress: number
  error?: string
  videoUrl?: string
  generateEndpoint: '/api/seedance-generate' | '/api/pixels-render-veo'
  veoTaskId?: string
}

export function buildBatchSelections(
  quote: DirectorBatchQuoteResponse,
  path: DirectorBatchPath,
  perShotOverrides?: Readonly<Record<string, PixelsRenderProvider>>,
): Array<{ shotId: string; provider: PixelsRenderProvider; requestId: string }> {
  return quote.shots.map((shot) => ({
    shotId: shot.shotId,
    provider:
      perShotOverrides?.[shot.shotId] ??
      (path === 'allVeo'
        ? 'veo'
        : path === 'allSeedance'
          ? 'seedance'
          : shot.recommendedProvider),
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
  for (const shot of quote.shots) {
    const provider =
      perShotOverrides[shot.shotId] ??
      (path === 'allVeo'
        ? 'veo'
        : path === 'allSeedance'
          ? 'seedance'
          : shot.recommendedProvider)
    const line = provider === 'veo' ? shot.veo : shot.seedance
    totalWei += BigInt(line.crtvaiRequired)
  }

  const crtvaiDisplay = Number(totalWei) / 1e18
  const usd = quote.totals.allVeo.formattedUsd.replace(/^\$/, '')
  const formattedUsd = `$${(crtvaiDisplay * (Number.parseFloat(usd) / quote.totals.allVeo.crtvaiDisplay)).toFixed(2)}`

  return {
    crtvaiRequired: totalWei.toString(),
    crtvaiDisplay,
    formattedUsd,
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
    job.status === 'failed'
      ? { ...job, status: 'queued', progress: 0, error: undefined }
      : job,
  )
}

/** After a page reload, in-flight shots should be re-enqueued (browser killed mid-poll). */
export function prepareJobsForResume(jobs: DirectorBatchShotJob[]): DirectorBatchShotJob[] {
  return jobs.map((job) =>
    job.status === 'running'
      ? { ...job, status: 'queued', progress: 0 }
      : job,
  )
}

export function isBatchQuoteExpired(expiresAt: string, nowMs = Date.now()): boolean {
  const expiresMs = new Date(expiresAt).getTime()
  return !Number.isFinite(expiresMs) || expiresMs <= nowMs
}

export function splitQueuedJobsByProvider(jobs: readonly DirectorBatchShotJob[]): {
  seedance: DirectorBatchShotJob[]
  veo: DirectorBatchShotJob[]
} {
  const queued = jobs.filter((job) => job.status === 'queued')
  return {
    seedance: queued.filter((job) => job.provider === 'seedance'),
    veo: queued.filter((job) => job.provider === 'veo'),
  }
}

/** Run Seedance and Veo worker pools in parallel under provider-specific limits. */
export async function runBatchJobsByProvider(
  jobs: readonly DirectorBatchShotJob[],
  limits: { seedance: number; veo: number },
  worker: (job: DirectorBatchShotJob) => Promise<void>,
): Promise<void> {
  const { seedance, veo } = splitQueuedJobsByProvider(jobs)
  await Promise.all([
    runWithConcurrency(seedance, limits.seedance, worker),
    runWithConcurrency(veo, limits.veo, worker),
  ])
}
