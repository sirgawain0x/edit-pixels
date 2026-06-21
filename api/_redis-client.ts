type RedisClient = import('@upstash/redis').Redis;

let redisClient: RedisClient | null = null;
let redisInitPromise: Promise<RedisClient | null> | null = null;

/**
 * Resolve Upstash/Vercel KV credentials.
 * Vercel Marketplace KV sets KV_REST_API_URL + KV_REST_API_TOKEN.
 * Upstash direct / older integrations use UPSTASH_REDIS_REST_*.
 */
function resolveRedisCredentials(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim() ||
    '';
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim() ||
    '';
  if (!url || !token) return null;
  return { url, token };
}

async function initRedis(): Promise<RedisClient | null> {
  const creds = resolveRedisCredentials();
  if (!creds) return null;

  try {
    const { Redis } = await import('@upstash/redis');
    // Always use resolved credentials so KV_REST_* and UPSTASH_* stay in sync.
    return new Redis({ url: creds.url, token: creds.token });
  } catch (e) {
    console.error('redis init failed', e);
    return null;
  }
}

/** Whether Redis credentials are present (does not load @upstash/redis). */
export function isRedisConfigured(): boolean {
  return resolveRedisCredentials() !== null;
}

/** Shared Redis client for credit ledger, promo codes, etc. Lazy-loads @upstash/redis. */
export async function getRedis(): Promise<RedisClient | null> {
  if (redisClient) return redisClient;
  if (!redisInitPromise) {
    redisInitPromise = initRedis().then((client) => {
      if (client) {
        redisClient = client;
      } else {
        redisInitPromise = null;
      }
      return client;
    });
  }
  return redisInitPromise;
}
