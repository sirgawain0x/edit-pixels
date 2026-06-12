/**
 * GET /api/credits-health
 * Diagnostic probe for credits API dependencies (Redis + viem).
 */

import { isRedisConfigured, getRedis } from './_redis-client';

export async function GET(): Promise<Response> {
  const redisConfigured = isRedisConfigured();
  let redisConnected = false;
  let viemOk = false;

  if (redisConfigured) {
    try {
      const redis = await getRedis();
      if (redis) {
        await redis.ping();
        redisConnected = true;
      }
    } catch (e) {
      console.error('credits-health redis ping failed', e);
    }
  }

  try {
    await import('viem');
    await import('viem/chains');
    viemOk = true;
  } catch (e) {
    console.error('credits-health viem import failed', e);
  }

  const ok = redisConnected || !redisConfigured ? viemOk : false;

  return Response.json(
    {
      redisConfigured,
      redisConnected,
      viemOk,
      ok,
    },
    { status: ok ? 200 : 503 }
  );
}
