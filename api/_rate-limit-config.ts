/// <reference types="node" />
/**
 * Central Pixels API rate-limit rules (Upstash sliding window).
 * Spec baseline: docs in pixels-agent-access.md §5; P1a applies to existing quote/render/director routes.
 */

export type RateLimitRouteClass = 'quote' | 'render' | 'director'

export type RateLimitMode = 'off' | 'observe' | 'enforce'

export interface SlidingWindowRule {
  /** Max requests allowed in the window. */
  limit: number
  /** Upstash duration string, e.g. "1 m". */
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`
}

export interface RouteRateLimitRules {
  ip: SlidingWindowRule
  identity: SlidingWindowRule
}

/** Fail-open when Redis is unavailable (quotes are cheap; blocking on KV outage hurts UX). */
export function rateLimitFailsOpen(routeClass: RateLimitRouteClass): boolean {
  return routeClass === 'quote'
}

export const PIXELS_RATE_LIMIT_RULES: Record<RateLimitRouteClass, RouteRateLimitRules> = {
  quote: {
    ip: { limit: 30, window: '1 m' },
    identity: { limit: 60, window: '1 m' },
  },
  render: {
    ip: { limit: 20, window: '1 m' },
    identity: { limit: 10, window: '1 m' },
  },
  director: {
    ip: { limit: 20, window: '1 m' },
    identity: { limit: 15, window: '1 m' },
  },
}

export function getRateLimitMode(): RateLimitMode {
  const raw = process.env.PIXELS_RATE_LIMIT_MODE?.trim().toLowerCase()
  if (raw === 'off' || raw === 'observe' || raw === 'enforce') return raw
  return 'observe'
}

export function isRateLimitEnabled(): boolean {
  return getRateLimitMode() !== 'off'
}
