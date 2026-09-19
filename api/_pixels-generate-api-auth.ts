/**
 * Shared Privy auth + JSON body parsing for Pixels generate API routes.
 */
// fallow-ignore-file complexity

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'

export interface PixelsGenerateAuthContext {
  address: string
}

export type AuthorizePixelsGenerateResult =
  | { ok: true; auth: PixelsGenerateAuthContext; body: Record<string, unknown> }
  | { ok: false; response: Response }

export async function authorizePixelsGeneratePost(
  request: Request,
): Promise<AuthorizePixelsGenerateResult> {
  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, response: Response.json({ error: 'invalid body' }, { status: 400 }) }
    }
    body = parsed as Record<string, unknown>
  } catch {
    return { ok: false, response: Response.json({ error: 'invalid body' }, { status: 400 }) }
  }

  const token = getBearerToken(request) || (typeof body.token === 'string' ? body.token : null)
  if (!token) {
    return { ok: false, response: Response.json({ error: 'missing authorization' }, { status: 401 }) }
  }

  const auth = await verifyPrivyAccessToken(
    token,
    typeof body.walletAddress === 'string' ? body.walletAddress : undefined,
  )
  if (!auth) {
    return { ok: false, response: Response.json({ error: 'invalid authorization' }, { status: 401 }) }
  }

  return { ok: true, auth, body }
}
