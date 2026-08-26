/**
 * Bind Evolink task ids to the paying wallet so poll routes stay private.
 */

import { getRedis, isRedisConfigured } from './_redis-client.js'

const TASK_KEY_PREFIX = 'pixels:flow:task:'
const TASK_TTL_SECONDS = 60 * 60 * 24 // 24h

const memoryTasks = new Map<string, { wallet: string; expiresAt: number }>()

export async function registerGenerativeTask(taskId: string, wallet: string): Promise<void> {
  const id = taskId.trim()
  const owner = wallet.trim().toLowerCase()
  if (!id || !owner) return

  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      await redis.set(`${TASK_KEY_PREFIX}${id}`, owner, { ex: TASK_TTL_SECONDS })
      return
    }
  }

  memoryTasks.set(id, {
    wallet: owner,
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

  const entry = memoryTasks.get(id)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    memoryTasks.delete(id)
    return null
  }
  return entry.wallet
}
