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

async function buildSlidingWindowLimiter(
  routeClass: RateLimitRouteClass,
  dimension: 'ip' | 'identity',
): Promise<Ratelimit | null> {
  const redis = await getRedis()
  if (!redis) return null
  const rule = PIXELS_RATE_LIMIT_RULES[routeClass][dimension]
  const { Ratelimit: RatelimitCtor } = await import('@upstash/ratelimit')
  return new RatelimitCtor({
    redis,
    limiter: RatelimitCtor.slidingWindow(rule.limit, rule.window),
    prefix: `pixels:rl:${routeClass}:${dimension}`,
    analytics: false,
    timeout: 1000,
    ephemeralCache: new Map(),
  })
}

async function getSlidingWindowLimiter(
  routeClass: RateLimitRouteClass,
  dimension: 'ip' | 'identity',
): Promise<Ratelimit | null> {
  const key = cacheKey(routeClass, dimension)
  let pending = limiterCache.get(key)
  if (!pending) {
    pending = buildSlidingWindowLimiter(routeClass, dimension)
    limiterCache.set(key, pending)
  }
  const limiter = await pending
  if (!limiter) {
    limiterCache.delete(key)
  }
  return limiter
}

/** Vercel client IP: x-vercel-forwarded-for, x-real-ip, then first x-forwarded-for hop. */
export function getClientIp(request: Request): string {
  const vercelForwarded = request.headers.get('x-vercel-forwarded-for')?.trim()
  if (vercelForwarded) return vercelForwarded.split(',')[0]?.trim() || vercelForwarded

  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const firstHop = xff.split(',')[0]?.trim()
    if (firstHop) return firstHop
  }
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

function allowDespiteBackendFailure(routeClass: RateLimitRouteClass): boolean {
  if (getRateLimitMode() === 'observe') return true
  return rateLimitFailsOpen(routeClass)
}

function logRateLimitBackendWarning(
  reason: 'redis_unavailable' | 'limiter_init_failed' | 'limit_failed',
  routeClass: RateLimitRouteClass,
  dimension: 'ip' | 'identity',
  error?: unknown,
): void {
  console.warn('pixels rate limit backend failure — allowing request', {
    reason,
    routeClass,
    dimension,
    mode: getRateLimitMode(),
    error: error instanceof Error ? error.message : error,
  })
}

function backendFailureOutcome(
  routeClass: RateLimitRouteClass,
): { outcome: 'allow' } | { outcome: 'backend_failed' } {
  if (allowDespiteBackendFailure(routeClass)) {
    return { outcome: 'allow' }
  }
  return { outcome: 'backend_failed' }
}

async function loadLimiterForRequest(
  routeClass: RateLimitRouteClass,
  dimension: 'ip' | 'identity',
): Promise<
  | { ok: true; limiter: Ratelimit }
  | { ok: false; outcome: 'allow' | 'backend_failed' }
> {
  try {
    const limiter = await getSlidingWindowLimiter(routeClass, dimension)
    if (limiter) return { ok: true, limiter }
    logRateLimitBackendWarning('redis_unavailable', routeClass, dimension)
    const failed = backendFailureOutcome(routeClass)
    return { ok: false, outcome: failed.outcome === 'allow' ? 'allow' : 'backend_failed' }
  } catch (error) {
    logRateLimitBackendWarning('limiter_init_failed', routeClass, dimension, error)
    const failed = backendFailureOutcome(routeClass)
    return { ok: false, outcome: failed.outcome === 'allow' ? 'allow' : 'backend_failed' }
  }
}

function outcomeWhenOverQuota(
  routeClass: RateLimitRouteClass,
  dimension: 'ip' | 'identity',
  identifier: string,
  result: LimitResult,
): { outcome: 'allow' } | { outcome: 'block'; response: Response } {
  if (getRateLimitMode() === 'observe') {
    console.warn('pixels rate limit would block', {
      routeClass,
      dimension,
      identifier: dimension === 'ip' ? identifier : `${identifier.slice(0, 10)}…`,
      mode: 'observe',
    })
    return { outcome: 'allow' }
  }
  return { outcome: 'block', response: tooManyRequestsResponse(result) }
}

async function runLimit(
  routeClass: RateLimitRouteClass,
  dimension: 'ip' | 'identity',
  identifier: string,
): Promise<
  | { outcome: 'allow' }
  | { outcome: 'block'; response: Response }
  | { outcome: 'backend_failed' }
> {
  if (!isRateLimitEnabled()) {
    return { outcome: 'allow' }
  }

  const loaded = await loadLimiterForRequest(routeClass, dimension)
  if (!loaded.ok) {
    return loaded.outcome === 'allow' ? { outcome: 'allow' } : { outcome: 'backend_failed' }
  }

  const rule = PIXELS_RATE_LIMIT_RULES[routeClass][dimension]
  let raw: Awaited<ReturnType<Ratelimit['limit']>>
  try {
    raw = await loaded.limiter.limit(identifier)
  } catch (error) {
    logRateLimitBackendWarning('limit_failed', routeClass, dimension, error)
    return backendFailureOutcome(routeClass)
  }

  const result: LimitResult = {
    success: raw.success,
    limit: rule.limit,
    remaining: raw.remaining,
    reset: raw.reset,
  }

  if (!result.success) {
    return outcomeWhenOverQuota(routeClass, dimension, identifier, result)
  }

  return { outcome: 'allow' }
}

function handleBackendFailure(routeClass: RateLimitRouteClass): Response | null {
  if (allowDespiteBackendFailure(routeClass)) {
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
  if (verdict.outcome === 'backend_failed') return handleBackendFailure(routeClass)
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
  if (verdict.outcome === 'backend_failed') return handleBackendFailure(routeClass)
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
