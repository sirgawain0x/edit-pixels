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

export type ParseJsonObjectBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }

export async function parseJsonObjectBody(request: Request): Promise<ParseJsonObjectBodyResult> {
  try {
    const parsed = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, response: Response.json({ error: 'invalid body' }, { status: 400 }) }
    }
    return { ok: true, body: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, response: Response.json({ error: 'invalid body' }, { status: 400 }) }
  }
}

export async function authorizePixelsGeneratePost(
  request: Request,
): Promise<AuthorizePixelsGenerateResult> {
  const parsedBody = await parseJsonObjectBody(request)
  if (!parsedBody.ok) return parsedBody
  const body = parsedBody.body

  const token = getBearerToken(request) || (typeof body.token === 'string' ? body.token : null)
  if (!token) {
    return {
      ok: false,
      response: Response.json({ error: 'missing authorization' }, { status: 401 }),
    }
  }

  // Tier / Unlock pricing uses the Privy-verified signer only — never a client wallet field.
  const auth = await verifyPrivyAccessToken(token)
  if (!auth) {
    return {
      ok: false,
      response: Response.json({ error: 'invalid authorization' }, { status: 401 }),
    }
  }

  return { ok: true, auth, body }
}
