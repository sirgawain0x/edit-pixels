/**
 * POST /api/flow-quote — live-curve CRTVAI quote for Flow (no spend).
 */
// fallow-ignore-file complexity

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import {
  clampFlowDuration,
  normalizeVeoQuality,
  quoteFlowTotalCredits,
  type NanobananaQuality,
  type VeoTier,
} from './_generative-pricing.js'
import { quoteFlowCreditsUsdc6 } from './flow-billing.js'
import { MetokenQuoteError } from './_metoken-curve-quote.js'
import { parseJsonObjectBody } from './_pixels-generate-api-auth.js'

function parseTier(body: Record<string, unknown>): VeoTier {
  const raw =
    typeof body.tier === 'string'
      ? body.tier
      : typeof body.speed === 'string'
        ? body.speed
        : 'standard'
  if (raw === 'fast' || raw === 'lite') return raw
  return 'standard'
}

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

  const tier = parseTier(body)
  const qualityRaw = typeof body.quality === 'string' ? body.quality : '720p'
  const quality = normalizeVeoQuality(qualityRaw, tier)
  const duration = clampFlowDuration(typeof body.duration === 'number' ? body.duration : 8)
  const stillCount = Math.min(
    2,
    Math.max(0, Math.floor(typeof body.stillCount === 'number' ? body.stillCount : 0)),
  )
  const stillQuality = (
    typeof body.stillQuality === 'string' ? body.stillQuality : '2K'
  ) as NanobananaQuality

  const totalCredits = quoteFlowTotalCredits({
    duration,
    quality: qualityRaw,
    tier,
    stillCount,
    stillQuality,
  })

  try {
    const quote = await quoteFlowCreditsUsdc6(totalCredits)
    if (!quote) {
      return Response.json({ error: 'quote_unpayable' }, { status: 402 })
    }

    return Response.json({
      quoteId: quote.quoteId,
      signature: quote.signature,
      expiresAtMs: quote.expiresAtMs,
      slippageBps: quote.slippageBps,
      duration,
      quality,
      tier,
      stillCount,
      estimatedUsdc6: quote.estimatedUsdc6,
      formattedUsd: `$${(quote.estimatedUsdc6 / 1_000_000).toFixed(2)}`,
      crtvaiRequired: quote.minCrtvaiWei.toString(),
      crtvaiDisplay: Number(quote.minCrtvaiWei) / 1e18,
    })
  } catch (error) {
    if (error instanceof MetokenQuoteError) {
      return Response.json({ error: error.code, message: error.message }, { status: 402 })
    }
    throw error
  }
}
