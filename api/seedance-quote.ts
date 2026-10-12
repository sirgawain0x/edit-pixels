/**
 * POST /api/seedance-quote — CRTVAI cost quote before Seedance spend.
 */
// fallow-ignore-file complexity

import { quoteSeedanceSpend } from './_seedance-billing.js'
import { isSeedanceGenerateEnabled, type SeedanceResolution } from './_seedance-pricing.js'
import { authenticateGenerativePost } from './_pixels-generate-route-auth.js'

export async function POST(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }

  const authenticated = await authenticateGenerativePost(request)
  if (!authenticated.ok) return authenticated.response
  const { body } = authenticated

  const duration = typeof body.duration === 'number' ? body.duration : 5
  const resolution: SeedanceResolution = body.resolution === '480p' ? '480p' : '720p'

  const quote = await quoteSeedanceSpend({ duration, resolution })

  return Response.json({
    quoteId: quote.quoteId,
    signature: quote.signature,
    expiresAtMs: quote.expiresAtMs,
    slippageBps: quote.slippageBps,
    duration: quote.duration,
    resolution: quote.resolution,
    estimatedUsdc6: quote.estimatedUsdc6,
    crtvaiRequired: quote.minCrtvaiWei.toString(),
    crtvaiDisplay: Number(quote.minCrtvaiWei) / 1e18,
    formattedUsd: `$${(quote.estimatedUsdc6 / 1_000_000).toFixed(2)}`,
  })
}
