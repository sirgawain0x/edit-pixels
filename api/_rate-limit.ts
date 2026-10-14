/// <reference types="node" />
/**
 * Upstash sliding-window rate limits for Pixels quote / render / director routes.
 * Reuses `getRedis()` from `_redis-client.ts` (same KV as payment ledger).
 */

import type { Ratelimit } from '@upstash/ratelimit'
import { getRedis } from './_redis-client.js'
import {
  getRateLimitMode,
  isRateLimitEnabled,
  PIXELS_RATE_LIMIT_RULES,
  rateLimitFailsOpen,
  type RateLimitRouteClass,
} from './_rate-limit-config.js'

type LimitResult = {
  success: boolean
  limit: number
  remaining: number
  reset: number
}

const limiterCache = new Map<string, Promise<Ratelimit | null>>()

function cacheKey(routeClass: RateLimitRouteClass, dimension: 'ip' | 'identity'): string {
  const rule = PIXELS_RATE_LIMIT_RULES[routeClass][dimension]
  return `${routeClass}:${dimension}:${rule.limit}:${rule.window}`
}

async function getSlidingWindowLimiter(
  routeClass: RateLimitRouteClass,
  dimension: 'ip' | 'identity',
): Promise<Ratelimit | null> {
  const key = cacheKey(routeClass, dimension)
  let pending = limiterCache.get(key)
  if (!pending) {
    pending = (async () => {
      const redis = await getRedis()
      if (!redis) return null
      const rule = PIXELS_RATE_LIMIT_RULES[routeClass][dimension]
      const { Ratelimit: RatelimitCtor } = await import('@upstash/ratelimit')
      return new RatelimitCtor({
        redis,
        limiter: RatelimitCtor.slidingWindow(rule.limit, rule.window),
        prefix: `pixels:rl:${routeClass}:${dimension}`,
        analytics: false,
      })
    })()
    limiterCache.set(key, pending)
  }
  return pending
}

/** First hop of x-forwarded-for, else x-real-ip, else a stable fallback for counting. */
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const firstHop = xff.split(',')[0]?.trim()
    if (firstHop) return firstHop
  }
  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  return 'unknown'
}

function retryAfterSeconds(resetMs: number): number {
  return Math.max(1, Math.ceil((resetMs - Date.now()) / 1000))
}

function buildRateLimitHeaders(result: LimitResult): Record<string, string> {
  const retryAfter = String(retryAfterSeconds(result.reset))
  return {
    'Retry-After': retryAfter,
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(Math.max(0, result.remaining)),
    'RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
  }
}

function redisUnavailableResponse(routeClass: RateLimitRouteClass): Response {
  return Response.json(
    { error: 'rate_limit_unavailable', message: 'Rate limiting temporarily unavailable' },
    {
      status: 503,
      headers: { 'Retry-After': '60' },
    },
  )
}

function tooManyRequestsResponse(result: LimitResult): Response {
  return Response.json(
    { error: 'rate_limit_exceeded' },
    { status: 429, headers: buildRateLimitHeaders(result) },
  )
}

async function runLimit(
  routeClass: RateLimitRouteClass,
  dimension: 'ip' | 'identity',
  identifier: string,
): Promise<
  | { outcome: 'allow' }
  | { outcome: 'block'; response: Response }
  | { outcome: 'redis_down' }
> {
  if (!isRateLimitEnabled()) {
    return { outcome: 'allow' }
  }

  const limiter = await getSlidingWindowLimiter(routeClass, dimension)
  if (!limiter) {
    return { outcome: 'redis_down' }
  }

  const rule = PIXELS_RATE_LIMIT_RULES[routeClass][dimension]
  const raw = await limiter.limit(identifier)
  const result: LimitResult = {
    success: raw.success,
    limit: rule.limit,
    remaining: raw.remaining,
    reset: raw.reset,
  }

  const mode = getRateLimitMode()
  if (!result.success) {
    if (mode === 'observe') {
      console.warn('pixels rate limit would block', {
        routeClass,
        dimension,
        identifier: dimension === 'ip' ? identifier : `${identifier.slice(0, 10)}…`,
        mode,
      })
      return { outcome: 'allow' }
    }
    return { outcome: 'block', response: tooManyRequestsResponse(result) }
  }

  return { outcome: 'allow' }
}

function handleRedisDown(routeClass: RateLimitRouteClass): Response | null {
  if (rateLimitFailsOpen(routeClass)) {
    return null
  }
  return redisUnavailableResponse(routeClass)
}

/** Per-client IP limit — call before auth. */
export async function rateLimitByClientIp(
  request: Request,
  routeClass: RateLimitRouteClass,
): Promise<Response | null> {
  const ip = getClientIp(request)
  const verdict = await runLimit(routeClass, 'ip', ip)
  if (verdict.outcome === 'block') return verdict.response
  if (verdict.outcome === 'redis_down') return handleRedisDown(routeClass)
  return null
}

/** Per verified signer wallet — call after identity resolution. */
export async function rateLimitByIdentity(
  request: Request,
  routeClass: RateLimitRouteClass,
  signer: string,
): Promise<Response | null> {
  const normalized = signer.trim().toLowerCase()
  if (!normalized.startsWith('0x')) {
    return null
  }
  const verdict = await runLimit(routeClass, 'identity', normalized)
  if (verdict.outcome === 'block') return verdict.response
  if (verdict.outcome === 'redis_down') return handleRedisDown(routeClass)
  return null
}

/** Director session list: IP + optional wallet query identity. */
export async function rateLimitDirectorSessionGet(request: Request): Promise<Response | null> {
  const ipBlocked = await rateLimitByClientIp(request, 'director')
  if (ipBlocked) return ipBlocked

  const url = new URL(request.url)
  const wallet = url.searchParams.get('wallet')?.trim().toLowerCase()
  if (wallet?.startsWith('0x')) {
    return rateLimitByIdentity(request, 'director', wallet)
  }
  return null
}

export interface CheckPixelsRateLimitsOptions {
  /** When false, skip the per-IP counter (after IP was already checked). Default true. */
  ip?: boolean
  /** Verified signer EOA for per-identity limits. */
  identity?: string | null
}

/** Shared entry for POST handlers: IP gate, optional identity gate. */
export async function checkPixelsRateLimits(
  request: Request,
  routeClass: RateLimitRouteClass,
  options: CheckPixelsRateLimitsOptions = {},
): Promise<Response | null> {
  if (options.ip !== false) {
    const ipBlocked = await rateLimitByClientIp(request, routeClass)
    if (ipBlocked) return ipBlocked
  }
  if (options.identity) {
    return rateLimitByIdentity(request, routeClass, options.identity)
  }
  return null
}

/** Test hook: reset cached limiters between tests. */
export function resetRateLimitersForTests(): void {
  limiterCache.clear()
}
