import { Redis } from '@upstash/redis';

const MINUTES_PER_CLAIM = 5;
const DEFAULT_FREE_MINUTES_PER_MONTH = 15;

function getFreeClaimsPerMonth(): number {
  const envVal = process.env.FREE_TIER_MINUTES_PER_MONTH;
  const minutes = envVal ? Number(envVal) : DEFAULT_FREE_MINUTES_PER_MONTH;
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.floor(minutes / MINUTES_PER_CLAIM);
}

let redisClient: Redis | null = null;
let redisInitAttempted = false;

function getRedis(): Redis | null {
  if (redisInitAttempted) return redisClient;
  redisInitAttempted = true;
  try {
    redisClient = Redis.fromEnv();
  } catch {
    redisClient = null;
  }
  return redisClient;
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function secondsUntilEndOfMonthUtc(): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );
  return Math.ceil((next.getTime() - now.getTime()) / 1000) + 86_400;
}

function keyFor(address: string): string {
  return `ft:${address.toLowerCase()}:${currentMonthKey()}`;
}

export function isFreeTierConfigured(): boolean {
  return getRedis() !== null && getFreeClaimsPerMonth() > 0;
}

export interface ClaimResult {
  ok: boolean;
  minutesRemaining: number;
  minutesGranted: number;
}

/**
 * Atomically claims one 5-minute free-tier increment for the given address.
 * Returns ok=false if the monthly allowance is exhausted or Redis is unavailable.
 * Callers are expected to verify signature ownership before invoking.
 */
export async function claimFiveFreeMinutes(
  address: string
): Promise<ClaimResult> {
  const redis = getRedis();
  const maxClaims = getFreeClaimsPerMonth();
  if (!redis || maxClaims <= 0) {
    return { ok: false, minutesRemaining: 0, minutesGranted: 0 };
  }
  const key = keyFor(address);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, secondsUntilEndOfMonthUtc());
  }
  if (count > maxClaims) {
    return { ok: false, minutesRemaining: 0, minutesGranted: 0 };
  }
  return {
    ok: true,
    minutesRemaining: (maxClaims - count) * MINUTES_PER_CLAIM,
    minutesGranted: MINUTES_PER_CLAIM,
  };
}

/**
 * Reads the remaining free minutes for the current month without mutating state.
 * Returns 0 when Redis is unavailable or the allowance is 0.
 */
export async function getRemainingFreeMinutes(
  address: string
): Promise<number> {
  const redis = getRedis();
  const maxClaims = getFreeClaimsPerMonth();
  if (!redis || maxClaims <= 0) return 0;
  const key = keyFor(address);
  const raw = await redis.get<number>(key);
  const used = typeof raw === 'number' ? raw : 0;
  const remainingClaims = Math.max(0, maxClaims - used);
  return remainingClaims * MINUTES_PER_CLAIM;
}
