/**
 * POST /api/seedance-quote — CRTVAI cost quote before Seedance spend.
 */
// fallow-ignore-file complexity

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { quoteSeedanceSpend } from './_seedance-billing.js'
import { isSeedanceGenerateEnabled, type SeedanceResolution } from './_seedance-pricing.js'

export async function POST(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return Response.json({ error: 'invalid body' }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const token = getBearerToken(request) || (typeof body.token === 'string' ? body.token : null)
  if (!token) {
    return Response.json({ error: 'missing authorization' }, { status: 401 })
  }

  const auth = await verifyPrivyAccessToken(
    token,
    typeof body.walletAddress === 'string' ? body.walletAddress : undefined,
  )
  if (!auth) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 })
  }

  const duration = typeof body.duration === 'number' ? body.duration : 5
  const resolution: SeedanceResolution = body.resolution === '480p' ? '480p' : '720p'

  const quote = await quoteSeedanceSpend({ duration, resolution })

  return Response.json({
    quoteId: quote.quoteId,
    duration: quote.duration,
    resolution: quote.resolution,
    estimatedUsdc6: quote.estimatedUsdc6,
    crtvaiRequired: quote.minCrtvaiWei.toString(),
    crtvaiDisplay: Number(quote.minCrtvaiWei) / 1e18,
    formattedUsd: `$${(quote.estimatedUsdc6 / 1_000_000).toFixed(2)}`,
  })
}
