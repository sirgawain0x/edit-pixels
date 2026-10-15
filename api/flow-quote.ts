/**
 * POST /api/flow-quote — live-curve CRTVAI quote for Flow (no spend).
 */
// fallow-ignore-file complexity

import { authenticateGenerativePost } from './_pixels-generate-route-auth.js'
import {
  clampFlowDuration,
  normalizeVeoQuality,
  quoteFlowTotalCredits,
  quoteNanobananaCredits,
  type NanobananaQuality,
  type VeoTier,
} from './_generative-pricing.js'
import { quoteFlowCreditsUsdc6 } from './flow-billing.js'
import { MetokenQuoteError } from './_metoken-curve-quote.js'
import { checkPixelsRateLimits } from './_rate-limit.js'

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
  const ipLimited = await checkPixelsRateLimits(request, 'quote')
  if (ipLimited) return ipLimited

  const authenticated = await authenticateGenerativePost(request)
  if (!authenticated.ok) return authenticated.response
  const { body, signer } = authenticated

  const identityLimited = await checkPixelsRateLimits(request, 'quote', {
    ip: false,
    identity: signer,
  })
  if (identityLimited) return identityLimited

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

    const videoCredits = quoteFlowTotalCredits({
      duration,
      quality: qualityRaw,
      tier,
      stillCount: 0,
      stillQuality,
    })
    const stillCredits =
      stillCount > 0 ? stillCount * quoteNanobananaCredits(stillQuality) : 0

    return Response.json({
      quoteId: quote.quoteId,
      signature: quote.signature,
      expiresAtMs: quote.expiresAtMs,
      slippageBps: quote.slippageBps,
      duration,
      quality,
      tier,
      stillCount,
      videoCredits,
      stillCredits,
      totalCredits,
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
