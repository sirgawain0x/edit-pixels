import type { DirectorBatchShotJob } from './director-batch-queue'

const STORAGE_KEY = 'pixels:director-batch:active-job'

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
