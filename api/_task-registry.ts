/**
 * Bind generative task ids to wallet + Vertex operation metadata.
 * Requires Upstash/Vercel KV on Vercel — instance memory is local-dev only.
 */
// fallow-ignore-file complexity,unused-export

import { getRedis, isRedisConfigured } from './_redis-client.js'

const TASK_KEY_PREFIX = 'pixels:flow:task:'
const TASK_META_PREFIX = 'pixels:flow:task-meta:'
const TASK_TTL_SECONDS = 60 * 60 * 24 // 24h

export interface GenerativeTaskMeta {
  operationName: string
  modelId: string
}

interface MemoryTaskEntry {
  wallet: string
  meta?: GenerativeTaskMeta
  expiresAt: number
}

const memoryTasks = new Map<string, MemoryTaskEntry>()

function allowMemoryFallback(): boolean {
  return !process.env.VERCEL
}

export async function registerGenerativeTask(
  taskId: string,
  wallet: string,
  meta?: GenerativeTaskMeta,
): Promise<void> {
  const id = taskId.trim()
  const owner = wallet.trim().toLowerCase()
  if (!id || !owner) return

  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      await redis.set(`${TASK_KEY_PREFIX}${id}`, owner, { ex: TASK_TTL_SECONDS })
      if (meta) {
        await redis.set(`${TASK_META_PREFIX}${id}`, JSON.stringify(meta), {
          ex: TASK_TTL_SECONDS,
        })
      }
      return
    }
  }

  if (!allowMemoryFallback()) {
    throw new Error('Task registry unavailable (configure Upstash/Vercel KV)')
  }

  memoryTasks.set(id, {
    wallet: owner,
    meta,
    expiresAt: Date.now() + TASK_TTL_SECONDS * 1000,
  })
}

export async function getGenerativeTaskOwner(taskId: string): Promise<string | null> {
  const id = taskId.trim()
  if (!id) return null

  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      const owner = await redis.get<string>(`${TASK_KEY_PREFIX}${id}`)
      return typeof owner === 'string' ? owner.toLowerCase() : null
    }
  }

  if (!allowMemoryFallback()) return null

  const entry = memoryTasks.get(id)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    memoryTasks.delete(id)
    return null
  }
  return entry.wallet
}

export async function getGenerativeTaskMeta(taskId: string): Promise<GenerativeTaskMeta | null> {
  const id = taskId.trim()
  if (!id) return null

  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      const raw = await redis.get<string>(`${TASK_META_PREFIX}${id}`)
      if (typeof raw !== 'string') return null
      try {
        return JSON.parse(raw) as GenerativeTaskMeta
      } catch {
        return null
      }
    }
  }

  if (!allowMemoryFallback()) return null

  const entry = memoryTasks.get(id)
  if (!entry || entry.expiresAt < Date.now()) return null
  return entry.meta ?? null
}
