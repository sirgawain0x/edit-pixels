import { Redis } from '@upstash/redis';

let redisClient: Redis | null = null;
let redisInitAttempted = false;

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

/** Shared Redis client for credit ledger, promo codes, etc. */
export function getRedis(): Redis | null {
  if (redisInitAttempted) return redisClient;
  redisInitAttempted = true;

  const creds = resolveRedisCredentials();
  if (!creds) {
    redisClient = null;
    return null;
  }

  try {
    redisClient = new Redis({ url: creds.url, token: creds.token });
  } catch {
    redisClient = null;
  }
  return redisClient;
}

export function isRedisConfigured(): boolean {
  return getRedis() !== null;
}
