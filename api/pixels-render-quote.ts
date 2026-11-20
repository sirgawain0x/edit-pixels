/**
 * POST /api/pixels-render-quote — multi-provider CRTVAI quotes (Omni + Veo + Seedance) before render spend.
 */
// fallow-ignore-file complexity

import { authenticateGenerativePost } from './_pixels-generate-route-auth.js'
import { quoteSeedanceSpend } from './_seedance-billing.js'
import { type SeedanceResolution } from './_seedance-pricing.js'
import { guardSeedanceQuoteRequest } from './_pixels-generate-guards.js'
import {
  clampFlowDuration,
  clampOmniDuration,
  quoteFlowTotalCredits,
  quoteOmniCredits,
  type NanobananaQuality,
} from './_generative-pricing.js'
import { quoteFlowCreditsUsdc6 } from './flow-billing.js'
import { checkPixelsRateLimits } from './_rate-limit.js'

const PIXELS_VEO_TIER = 'standard' as const
const PIXELS_VEO_QUALITY = '720p'
const PIXELS_OMNI_QUALITY = '720p'
const PIXELS_STILL_QUALITY: NanobananaQuality = '2K'

export async function POST(request: Request): Promise<Response> {
  const guarded = await guardSeedanceQuoteRequest(request)
  if (guarded) return guarded

  const authenticated = await authenticateGenerativePost(request)
  if (!authenticated.ok) return authenticated.response
  const { body, signer } = authenticated

  const identityLimited = await checkPixelsRateLimits(request, 'quote', {
    ip: false,
    identity: signer,
  })
  if (identityLimited) return identityLimited

  const durationRaw = typeof body.duration === 'number' ? body.duration : 5
  const resolution: SeedanceResolution = body.resolution === '480p' ? '480p' : '720p'

  const omniDuration = clampOmniDuration(durationRaw)
  const omniCredits = quoteOmniCredits({
    duration: omniDuration,
    quality: PIXELS_OMNI_QUALITY,
  })
  const omniQuote = await quoteFlowCreditsUsdc6(omniCredits)
  if (!omniQuote) {
    return Response.json({ error: 'invalid omni quote' }, { status: 400 })
  }

  const veoDuration = clampFlowDuration(durationRaw)
  const veoCredits = quoteFlowTotalCredits({
    duration: veoDuration,
    quality: PIXELS_VEO_QUALITY,
    tier: PIXELS_VEO_TIER,
    stillCount: 1,
    stillQuality: PIXELS_STILL_QUALITY,
  })
  const veoQuote = await quoteFlowCreditsUsdc6(veoCredits)
  if (!veoQuote) {
    return Response.json({ error: 'invalid veo quote' }, { status: 400 })
  }

  const seedanceQuote = await quoteSeedanceSpend({ duration: durationRaw, resolution })

  return Response.json({
    omni: {
      provider: 'omni',
      duration: omniDuration,
      stillCount: 0,
      estimatedUsdc6: omniQuote.estimatedUsdc6,
      crtvaiRequired: omniQuote.minCrtvaiWei.toString(),
      crtvaiDisplay: Number(omniQuote.minCrtvaiWei) / 1e18,
      formattedUsd: `$${(omniQuote.estimatedUsdc6 / 1_000_000).toFixed(2)}`,
      label: 'Gemini Omni 1.2 Flash',
      detail: 'Fast text-to-video with native audio (best value)',
    },
    veo: {
      provider: 'veo',
      duration: veoDuration,
      stillCount: 1,
      estimatedUsdc6: veoQuote.estimatedUsdc6,
      crtvaiRequired: veoQuote.minCrtvaiWei.toString(),
      crtvaiDisplay: Number(veoQuote.minCrtvaiWei) / 1e18,
      formattedUsd: `$${(veoQuote.estimatedUsdc6 / 1_000_000).toFixed(2)}`,
      label: 'Google Veo 3.1',
      detail: 'Gemini still + Veo image-to-video',
    },
    seedance: {
      provider: 'seedance',
      quoteId: seedanceQuote.quoteId,
      duration: seedanceQuote.duration,
      resolution: seedanceQuote.resolution,
      estimatedUsdc6: seedanceQuote.estimatedUsdc6,
      crtvaiRequired: seedanceQuote.minCrtvaiWei.toString(),
      crtvaiDisplay: Number(seedanceQuote.minCrtvaiWei) / 1e18,
      formattedUsd: `$${(seedanceQuote.estimatedUsdc6 / 1_000_000).toFixed(2)}`,
      label: 'Higgsfield Seedance 2.5',
      detail: 'Text-to-video (character consistency)',
    },
  })
}
