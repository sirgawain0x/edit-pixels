/**
 * Shared Privy auth + JSON body parsing for Pixels generate API routes.
 */
// fallow-ignore-file complexity

import { resolvePixelsIdentity } from './_pixels-identity.js'
import { parseJsonObjectBody } from './_pixels-json-body.js'

export interface PixelsGenerateAuthContext {
  /** Active Privy-linked signer EOA (identity). */
  address: string
  signer: string
}

export type AuthorizePixelsGenerateResult =
  | { ok: true; auth: PixelsGenerateAuthContext; body: Record<string, unknown> }
  | { ok: false; response: Response }

export async function authorizePixelsGeneratePost(
  request: Request,
): Promise<AuthorizePixelsGenerateResult> {
  const resolved = await resolvePixelsIdentity(request)
  if (!resolved.ok) return resolved
  const signer = resolved.identity.signer
  return {
    ok: true,
    auth: { address: signer, signer },
    body: resolved.body,
  }
}
