/// <reference types="node" />
/**
 * Central Pixels API rate-limit rules (Upstash sliding window).
 * Spec baseline: docs in pixels-agent-access.md §5; P1a applies to existing quote/render/director routes.
 */

export type RateLimitRouteClass = 'quote' | 'render' | 'director' | 'tts' | 'transcribe'

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
  // `transcribe` is a pre-payment quote too: nothing is spent server-side and the
  // run is guarded by the free-run record, so a KV outage must not block it.
  return routeClass === 'quote' || routeClass === 'transcribe'
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
  /** Director read-aloud (Gemini TTS). One click may fetch several sentence chunks. */
  tts: {
    ip: { limit: 40, window: '1 m' },
    identity: { limit: 30, window: '1 m' },
  },
  /** Cloud ("precision") transcription quote. One request per run; each writes a job record. */
  transcribe: {
    ip: { limit: 30, window: '1 m' },
    identity: { limit: 10, window: '1 m' },
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
