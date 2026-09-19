import type { PixelsRenderProvider } from '@/config/pixels-render'
import type { DirectorBatchShotJob } from './director-batch-queue'

const STORAGE_KEY = 'pixels:director-batch:active-job'
const PENDING_CONFIRM_KEY = 'pixels:director-batch:pending-confirm'

export interface DirectorBatchPendingConfirm {
  batchQuoteId: string
  paymentTxHash: string | null
  selections: Array<{ shotId: string; provider: PixelsRenderProvider; requestId: string }>
}

export interface DirectorBatchActiveJob {
  batchConfirmId: string
  batchQuoteId: string
  storyboardId?: string
  jobs: DirectorBatchShotJob[]
  startedAtMs: number
}

export function loadDirectorBatchJob(): DirectorBatchActiveJob | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DirectorBatchActiveJob
    if (!parsed.batchConfirmId || !Array.isArray(parsed.jobs)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveDirectorBatchJob(job: DirectorBatchActiveJob): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(job))
}

export function clearDirectorBatchJob(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}

export function updateDirectorBatchJobJobs(
  jobs: DirectorBatchShotJob[],
): DirectorBatchActiveJob | null {
  const current = loadDirectorBatchJob()
  if (!current) return null
  const next = { ...current, jobs }
  saveDirectorBatchJob(next)
  return next
}

export function loadDirectorBatchPendingConfirm(): DirectorBatchPendingConfirm | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CONFIRM_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DirectorBatchPendingConfirm
    if (!parsed.batchQuoteId || !Array.isArray(parsed.selections)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveDirectorBatchPendingConfirm(pending: DirectorBatchPendingConfirm): void {
  sessionStorage.setItem(PENDING_CONFIRM_KEY, JSON.stringify(pending))
}

export function clearDirectorBatchPendingConfirm(): void {
  sessionStorage.removeItem(PENDING_CONFIRM_KEY)
}
