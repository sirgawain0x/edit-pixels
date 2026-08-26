/// <reference types="node" />
// fallow-ignore-file unused-file,complexity
/**
 * Shared Upstash / Vercel KV Redis client for payment ledgers and task ownership.
 */

type RedisClient = import('@upstash/redis').Redis

let redisClient: RedisClient | null = null
let redisInitPromise: Promise<RedisClient | null> | null = null

function resolveRedisCredentials(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim() || ''
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim() || ''
  if (!url || !token) return null
  return { url, token }
}

async function initRedis(): Promise<RedisClient | null> {
  const creds = resolveRedisCredentials()
  if (!creds) return null

  try {
    const { Redis } = await import('@upstash/redis')
    return new Redis({ url: creds.url, token: creds.token })
  } catch (e) {
    console.error('redis init failed', e)
    return null
  }
}

export function isRedisConfigured(): boolean {
  return resolveRedisCredentials() !== null
}

export async function getRedis(): Promise<RedisClient | null> {
  if (redisClient) return redisClient
  if (!redisInitPromise) {
    redisInitPromise = initRedis().then((client) => {
      if (client) {
        redisClient = client
      } else {
        redisInitPromise = null
      }
      return client
    })
  }
  return redisInitPromise
}
