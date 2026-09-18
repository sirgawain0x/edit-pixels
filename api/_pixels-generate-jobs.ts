/**
 * Server-side job status for Creative Pixels generate (Seedance sync path).
 * Survives client refresh while a long-running generate request is in flight.
 */
// fallow-ignore-file complexity

import { getRedis, isRedisConfigured } from './_redis-client.js'

const JOB_KEY_PREFIX = 'pixels:generate:job:'
const JOB_TTL_SECONDS = 60 * 60 * 24 // 24h

export type PixelsGenerateProvider = 'seedance' | 'veo'

export type PixelsGenerateJobStatus = 'processing' | 'completed' | 'failed'

export interface PixelsGenerateJob {
  id: string
  wallet: string
  provider: PixelsGenerateProvider
  status: PixelsGenerateJobStatus
  progress: number
  model: string
  /** Vertex task id for Veo polling via /api/generate-task. */
  veoTaskId?: string
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
      return next
    }
  }

  if (!allowMemoryFallback()) return null

  memoryJobs.set(id, {
    job: next,
    expiresAt: Date.now() + JOB_TTL_SECONDS * 1000,
  })
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
