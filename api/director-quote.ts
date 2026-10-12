/**
 * POST /api/director-quote — live-curve CRTVAI quote for a Director brief (no spend).
 */
// fallow-ignore-file complexity

import { quoteDirectorForWallet } from './director-billing.js'
import { MetokenQuoteError } from './_metoken-curve-quote.js'
import { authorizePixelsGeneratePost } from './_pixels-generate-api-auth.js'

export async function POST(request: Request): Promise<Response> {
  const authorized = await authorizePixelsGeneratePost(request)
  if (!authorized.ok) return authorized.response
  const { auth, body } = authorized

  const audioDurationSeconds =
    typeof body.audioDurationSeconds === 'number' ? body.audioDurationSeconds : NaN
  if (!Number.isFinite(audioDurationSeconds) || audioDurationSeconds <= 0) {
    return Response.json({ error: 'audioDurationSeconds required' }, { status: 400 })
  }

  try {
    const quote = await quoteDirectorForWallet(audioDurationSeconds, auth.address)
    if (!quote) {
      return Response.json({ error: 'quote_unpayable' }, { status: 402 })
    }

    return Response.json({
      quoteId: quote.quoteId,
      signature: quote.signature,
      expiresAtMs: quote.expiresAtMs,
      slippageBps: quote.slippageBps,
      billableMinutes: quote.billableMinutes,
      estimatedUsdc6: quote.estimatedUsdc6,
      formattedUsd: `$${(quote.estimatedUsdc6 / 1_000_000).toFixed(2)}`,
      crtvaiRequired: quote.minCrtvaiWei.toString(),
      crtvaiDisplay: Number(quote.minCrtvaiWei) / 1e18,
      tier: quote.tier,
      audioDurationSeconds,
    })
  } catch (error) {
    if (error instanceof MetokenQuoteError) {
      return Response.json({ error: error.code, message: error.message }, { status: 402 })
    }
    throw error
  }
}
