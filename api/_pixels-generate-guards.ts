/**
 * Shared pre-auth guards for Pixels generate / quote routes.
 */

import { isSeedanceGenerateEnabled } from './_seedance-pricing.js'
import { checkPixelsRateLimits } from './_rate-limit.js'

export async function guardSeedanceQuoteRequest(request: Request): Promise<Response | null> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }
  return checkPixelsRateLimits(request, 'quote')
}
