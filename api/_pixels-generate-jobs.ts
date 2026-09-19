/**
 * Server-side job status for Creative Pixels generate (Seedance + Veo).
 * Survives client refresh while a long-running generate request is in flight.
 */
// fallow-ignore-file complexity

import { getRedis, isRedisConfigured } from './_redis-client.js'

const JOB_KEY_PREFIX = 'pixels:generate:job:'
const VEO_INDEX_PREFIX = 'pixels:generate:veo:'
const JOB_TTL_SECONDS = 60 * 60 * 24 // 24h

export type PixelsGenerateProvider = 'seedance' | 'veo'

export type PixelsGenerateJobStatus = 'processing' | 'completed' | 'failed' | 'cancelled'

export interface PixelsGenerateJob {
  id: string
  wallet: string
  provider: PixelsGenerateProvider
  status: PixelsGenerateJobStatus
  progress: number
  model: string
  /** Vertex task id for Veo polling via /api/generate-task. */
  veoTaskId?: string
  /** Treasury CRTVAI transfer consumed for this job. */
  paymentTxHash?: string
  /** True after releaseFlowPayment succeeds for this job. */
  paymentReleased?: boolean
  output?: { video_url?: string }
  error?: { code: string; message: string; type: string }
  costUsdc6?: number
  crtvaiRequired?: string
  mock?: boolean
  updatedAtMs: number
}

interface MemoryJobEntry {
  job: PixelsGenerateJob
  expiresAt: number
}

const memoryJobs = new Map<string, MemoryJobEntry>()
const memoryVeoIndex = new Map<string, string>()

function allowMemoryFallback(): boolean {
  return !process.env.VERCEL
}

function serializeJob(job: PixelsGenerateJob): string {
  return JSON.stringify(job)
}

function parseJob(raw: string): PixelsGenerateJob | null {
  try {
    const parsed = JSON.parse(raw) as PixelsGenerateJob
    if (!parsed?.id || !parsed.wallet || !parsed.provider || !parsed.status) return null
    return parsed
  } catch {
    return null
  }
}

async function indexVeoTask(veoTaskId: string, jobId: string): Promise<void> {
  const veoId = veoTaskId.trim()
  const id = jobId.trim()
  if (!veoId || !id) return

  memoryVeoIndex.set(veoId, id)

  if (!isRedisConfigured()) return
  const redis = await getRedis()
  if (!redis) return
  await redis.set(`${VEO_INDEX_PREFIX}${veoId}`, id, { ex: JOB_TTL_SECONDS })
}

export async function registerPixelsGenerateJob(
  job: Omit<PixelsGenerateJob, 'updatedAtMs'> & { updatedAtMs?: number },
): Promise<void> {
  const id = job.id.trim()
  const owner = job.wallet.trim().toLowerCase()
  if (!id || !owner) return

  const record: PixelsGenerateJob = {
    ...job,
    id,
    wallet: owner,
    updatedAtMs: job.updatedAtMs ?? Date.now(),
  }

  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      await redis.set(`${JOB_KEY_PREFIX}${id}`, serializeJob(record), { ex: JOB_TTL_SECONDS })
      if (record.veoTaskId) {
        await indexVeoTask(record.veoTaskId, id)
      }
      return
    }
  }

  if (!allowMemoryFallback()) {
    throw new Error('Pixels generate job registry unavailable (configure Upstash/Vercel KV)')
  }

  memoryJobs.set(id, {
    job: record,
    expiresAt: Date.now() + JOB_TTL_SECONDS * 1000,
  })
  if (record.veoTaskId) {
    memoryVeoIndex.set(record.veoTaskId, id)
  }
}

export async function updatePixelsGenerateJob(
  id: string,
  patch: Partial<Omit<PixelsGenerateJob, 'id' | 'wallet'>>,
): Promise<PixelsGenerateJob | null> {
  const existing = await getPixelsGenerateJob(id)
  if (!existing) return null

  const next: PixelsGenerateJob = {
    ...existing,
    ...patch,
    id: existing.id,
    wallet: existing.wallet,
    updatedAtMs: Date.now(),
  }

  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      await redis.set(`${JOB_KEY_PREFIX}${id}`, serializeJob(next), { ex: JOB_TTL_SECONDS })
      if (next.veoTaskId) {
        await indexVeoTask(next.veoTaskId, id)
      }
      return next
    }
  }

  if (!allowMemoryFallback()) return null

  memoryJobs.set(id, {
    job: next,
    expiresAt: Date.now() + JOB_TTL_SECONDS * 1000,
  })
  if (next.veoTaskId) {
    memoryVeoIndex.set(next.veoTaskId, id)
  }
  return next
}

export async function getPixelsGenerateJob(id: string): Promise<PixelsGenerateJob | null> {
  const trimmed = id.trim()
  if (!trimmed) return null

  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      const raw = await redis.get<string>(`${JOB_KEY_PREFIX}${trimmed}`)
      if (typeof raw === 'string') return parseJob(raw)
    }
  }

  if (!allowMemoryFallback()) return null

  const entry = memoryJobs.get(trimmed)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    memoryJobs.delete(trimmed)
    return null
  }
  return entry.job
}

export async function getPixelsGenerateJobIdByVeoTask(
  veoTaskId: string,
): Promise<string | null> {
  const trimmed = veoTaskId.trim()
  if (!trimmed) return null

  const cached = memoryVeoIndex.get(trimmed)
  if (cached) return cached

  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      const jobId = await redis.get<string>(`${VEO_INDEX_PREFIX}${trimmed}`)
      if (typeof jobId === 'string') {
        memoryVeoIndex.set(trimmed, jobId)
        return jobId
      }
    }
  }

  return null
}

/** Test-only reset for in-memory job store. */
export function __resetPixelsGenerateJobsForTest(): void {
  memoryJobs.clear()
  memoryVeoIndex.clear()
}
