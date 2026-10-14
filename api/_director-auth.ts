/// <reference types="node" />
/**
 * Shared authorization for Creative Director API routes.
 */

import { timingSafeEqual } from 'node:crypto'

function timingSafeSecretMatch(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// fallow-ignore-next-line complexity
function normalizeHost(value: string | null): string | null {
  if (!value) return null
  try {
    if (value.includes('://')) {
      return new URL(value).host.split(':')[0]?.toLowerCase() ?? null
    }
    return value.split(':')[0]?.toLowerCase() ?? null
  } catch {
    return null
  }
}

/** True when the request presents DIRECTOR_API_SECRET (server automation bypass). */
export function isDirectorSecretAuthorized(request: Request): boolean {
  const secret = process.env.DIRECTOR_API_SECRET?.trim()
  if (!secret) return false
  const auth = request.headers.get('authorization')
  const headerSecret = request.headers.get('x-director-secret')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null
  return timingSafeSecretMatch(bearer, secret) || timingSafeSecretMatch(headerSecret, secret)
}

const ALLOWLIST_ENV = 'PIXELS_DIRECTOR_SECRET_SIGNER_ALLOWLIST'

function parseDirectorSecretSignerAllowlist(): Set<string> {
  const raw = process.env[ALLOWLIST_ENV]?.trim()
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.startsWith('0x') && entry.length >= 42),
  )
}

/** Automation signers that may be asserted with DIRECTOR_API_SECRET alone (no Privy). */
export function isDirectorSecretAllowlistedSigner(signer: `0x${string}`): boolean {
  return parseDirectorSecretSignerAllowlist().has(signer.toLowerCase())
}

/**
 * @deprecated Browser traffic must use Privy via `authorizePixelsGeneratePost` on `/api/director`.
 * Kept for routes that still gate on same-origin only.
 */
// fallow-ignore-next-line complexity
export function assertDirectorAuthorized(request: Request): Response | null {
  if (isDirectorSecretAuthorized(request)) {
    return null
  }

  if (process.env.VERCEL) {
    const host = normalizeHost(request.headers.get('host'))
    const originHost = normalizeHost(request.headers.get('origin'))
    const refererHost = normalizeHost(request.headers.get('referer'))
    if (host && (originHost === host || refererHost === host)) {
      return null
    }
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
