/**
 * Shared feature-flag guard + Privy JSON POST auth for Vercel API routes.
 */

import {
  authorizePixelsGeneratePost,
  type AuthorizePixelsGenerateResult,
} from './_pixels-generate-api-auth.js'

export async function authorizeFeatureGatedPrivyPost(
  request: Request,
  isEnabled: () => boolean,
): Promise<AuthorizePixelsGenerateResult | { ok: false; response: Response }> {
  if (!isEnabled()) {
    return { ok: false, response: Response.json({ error: 'feature_disabled' }, { status: 404 }) }
  }
  return authorizePixelsGeneratePost(request)
}
