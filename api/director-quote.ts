/**
 * POST /api/director-quote — live-curve CRTVAI quote for a Director brief (no spend).
 */
// fallow-ignore-file complexity

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { quoteDirectorForWallet } from './director-billing.js'
import { MetokenQuoteError } from './_metoken-curve-quote.js'
import { parseJsonObjectBody } from './_pixels-generate-api-auth.js'

export async function POST(request: Request): Promise<Response> {
  const parsedBody = await parseJsonObjectBody(request)
  if (!parsedBody.ok) return parsedBody.response
  const body = parsedBody.body

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
