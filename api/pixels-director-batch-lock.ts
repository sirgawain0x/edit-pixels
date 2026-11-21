/**
 * POST /api/pixels-director-batch-lock — extend a batch quote TTL before the
 * wallet round-trip so the quote cannot expire between payment and confirm.
 */
// fallow-ignore-file complexity,duplicate-export

import { authorizePixelsGeneratePost } from './_pixels-generate-api-auth.js'
import { checkPixelsRateLimits } from './_rate-limit.js'
import { isSeedanceGenerateEnabled } from './_seedance-pricing.js'
import { lockDirectorBatchQuote } from './_director-batch-store.js'

export async function POST(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }

  const ipLimited = await checkPixelsRateLimits(request, 'render')
  if (ipLimited) return ipLimited

  const authorized = await authorizePixelsGeneratePost(request)
  if (!authorized.ok) return authorized.response
  const { body } = authorized

  const identityLimited = await checkPixelsRateLimits(request, 'render', {
    ip: false,
    identity: authorized.auth.signer,
  })
  if (identityLimited) return identityLimited

  const batchQuoteId =
    typeof body.batchQuoteId === 'string'
      ? body.batchQuoteId
      : typeof body.batch_quote_id === 'string'
        ? body.batch_quote_id
        : ''
  if (!batchQuoteId.trim()) {
    return Response.json({ error: 'batchQuoteId required' }, { status: 400 })
  }

  const lock = await lockDirectorBatchQuote(batchQuoteId)
  if (!lock.ok) {
    return Response.json({ error: lock.error }, { status: 400 })
  }

  return Response.json({
    ok: true,
    expiresAt: new Date(lock.expiresAtMs).toISOString(),
  })
}
