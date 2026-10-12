/**
 * POST /api/pixels-render-quote — dual CRTVAI quotes (Veo + Seedance) before render spend.
 */
// fallow-ignore-file complexity

import { authenticateGenerativePost } from './_pixels-generate-route-auth.js'
import { quoteSeedanceSpend } from './_seedance-billing.js'
import { isSeedanceGenerateEnabled, type SeedanceResolution } from './_seedance-pricing.js'
import {
  clampFlowDuration,
  quoteFlowTotalCredits,
  quoteNanobananaCredits,
  type NanobananaQuality,
} from './_generative-pricing.js'
import { quoteFlowCreditsUsdc6 } from './flow-billing.js'

const PIXELS_VEO_TIER = 'standard' as const
const PIXELS_VEO_QUALITY = '720p'
const PIXELS_STILL_QUALITY: NanobananaQuality = '2K'

export async function POST(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }

  const authenticated = await authenticateGenerativePost(request)
  if (!authenticated.ok) return authenticated.response
  const { body } = authenticated

  const durationRaw = typeof body.duration === 'number' ? body.duration : 5
  const resolution: SeedanceResolution = body.resolution === '480p' ? '480p' : '720p'

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
