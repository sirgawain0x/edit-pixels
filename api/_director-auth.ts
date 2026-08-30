/// <reference types="node" />
/**
 * Shared authorization for Creative Director API routes.
 */

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

/**
 * Block unauthenticated abuse of the Vertex proxy on Vercel.
 * - Production: same-origin browser requests, or DIRECTOR_API_SECRET bearer/header
 * - Local dev: open (no VERCEL env)
 */
// fallow-ignore-next-line complexity
export function assertDirectorAuthorized(request: Request): Response | null {
  const secret = process.env.DIRECTOR_API_SECRET?.trim()
  if (secret) {
    const auth = request.headers.get('authorization')
    const headerSecret = request.headers.get('x-director-secret')
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null
    if (bearer === secret || headerSecret === secret) {
      return null
    }
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
