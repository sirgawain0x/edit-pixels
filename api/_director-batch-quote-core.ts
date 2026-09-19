/**
 * Batch quote logic for Director storyboard → Pixels Generate (no spend).
 */
// fallow-ignore-file complexity

import { quoteSeedanceSpend } from './_seedance-billing.js'
import {
  clampFlowDuration,
  quoteFlowTotalCredits,
  quoteNanobananaCredits,
  type NanobananaQuality,
} from './_generative-pricing.js'
import { quoteFlowCreditsUsdc6 } from './flow-billing.js'
import {
  mapDirectorShotToGenerate,
  pickDirectorShotProvider,
  sumCrtvaiWei,
  type DirectorProviderPreference,
  type DirectorStoryboardShotInput,
  type PixelsRenderProvider,
} from './_director-generate-map.js'
import {
  saveDirectorBatchQuote,
  type DirectorBatchShotQuoteRecord,
} from './_director-batch-store.js'
import type { SeedanceResolution } from './_seedance-pricing.js'

const PIXELS_VEO_TIER = 'standard' as const
const PIXELS_VEO_QUALITY = '720p'
const PIXELS_STILL_QUALITY: NanobananaQuality = '2K'

export interface DirectorBatchQuoteShotResult {
  shotId: string
  recommendedProvider: PixelsRenderProvider
  generate: {
    prompt: string
    duration: number
    veoDuration: number
    seedanceDuration: number
    aspect_ratio: string
    resolution: SeedanceResolution
  }
  veo: {
    provider: 'veo'
    duration: number
    estimatedUsdc6: number
    crtvaiRequired: string
    crtvaiDisplay: number
    formattedUsd: string
  }
  seedance: {
    provider: 'seedance'
    quoteId: string
    duration: number
    resolution: SeedanceResolution
    estimatedUsdc6: number
    crtvaiRequired: string
    crtvaiDisplay: number
    formattedUsd: string
  }
}

export interface DirectorBatchQuoteResult {
  batchQuoteId: string
  expiresAt: string
  shotCount: number
  shots: DirectorBatchQuoteShotResult[]
  totals: {
    allVeo: {
      crtvaiRequired: string
      crtvaiDisplay: number
      formattedUsd: string
      estimatedUsdc6: number
    }
    allSeedance: {
      crtvaiRequired: string
      crtvaiDisplay: number
      formattedUsd: string
      estimatedUsdc6: number
    }
    recommendedMix: {
      crtvaiRequired: string
      crtvaiDisplay: number
      formattedUsd: string
      estimatedUsdc6: number
      providers: { veo: number; seedance: number }
    }
  }
}

function quoteVeoForShot(veoDuration: number): {
  estimatedUsdc6: number
  crtvaiWei: bigint
} | null {
  const duration = clampFlowDuration(veoDuration)
  const credits = quoteFlowTotalCredits({
    duration,
    quality: PIXELS_VEO_QUALITY,
    tier: PIXELS_VEO_TIER,
    stillCount: 1,
    stillQuality: PIXELS_STILL_QUALITY,
  })
  const quote = quoteFlowCreditsUsdc6(credits)
  if (!quote) return null
  return { estimatedUsdc6: quote.estimatedUsdc6, crtvaiWei: quote.minCrtvaiWei }
}

function formatQuoteLine(estimatedUsdc6: number, crtvaiWei: bigint) {
  return {
    estimatedUsdc6,
    crtvaiRequired: crtvaiWei.toString(),
    crtvaiDisplay: Number(crtvaiWei) / 1e18,
    formattedUsd: `$${(estimatedUsdc6 / 1_000_000).toFixed(2)}`,
  }
}

export async function quoteDirectorStoryboardBatch(input: {
  wallet: string
  shots: DirectorStoryboardShotInput[]
  providerPreference?: DirectorProviderPreference | null
  storyboardId?: string | null
  defaultResolution?: SeedanceResolution
}): Promise<{ ok: true; quote: DirectorBatchQuoteResult } | { ok: false; error: string }> {
  if (!Array.isArray(input.shots) || input.shots.length === 0) {
    return { ok: false, error: 'shots required' }
  }
  if (input.shots.length > 50) {
    return { ok: false, error: 'too many shots (max 50)' }
  }

  const defaultResolution = input.defaultResolution === '480p' ? '480p' : '720p'
  const shotResults: DirectorBatchQuoteShotResult[] = []
  const storeShots: DirectorBatchShotQuoteRecord[] = []

  let allVeoWei = 0n
  let allSeedanceWei = 0n
  let mixWei = 0n
  let mixUsdc6 = 0
  let mixVeo = 0
  let mixSeedance = 0

  for (const rawShot of input.shots) {
    const mapped = mapDirectorShotToGenerate({
      ...rawShot,
      resolution: rawShot.resolution ?? defaultResolution,
    })
    if (!mapped) {
      return { ok: false, error: `invalid shot: ${rawShot.shotId ?? 'unknown'}` }
    }

    const veoQuote = quoteVeoForShot(mapped.veoDuration)
    if (!veoQuote) {
      return { ok: false, error: `veo quote failed for shot ${mapped.shotId}` }
    }

    const seedanceQuote = await quoteSeedanceSpend({
      duration: mapped.seedanceDuration,
      resolution: mapped.resolution,
    })

    const recommendedProvider = pickDirectorShotProvider(rawShot, input.providerPreference)
    const recommendedWei =
      recommendedProvider === 'seedance' ? seedanceQuote.minCrtvaiWei : veoQuote.crtvaiWei
    const recommendedUsdc6 =
      recommendedProvider === 'seedance'
        ? seedanceQuote.estimatedUsdc6
        : veoQuote.estimatedUsdc6

    allVeoWei += veoQuote.crtvaiWei
    allSeedanceWei += seedanceQuote.minCrtvaiWei
    mixWei += recommendedWei
    mixUsdc6 += recommendedUsdc6
    if (recommendedProvider === 'veo') mixVeo += 1
    else mixSeedance += 1

    const veoFormatted = formatQuoteLine(veoQuote.estimatedUsdc6, veoQuote.crtvaiWei)
    const seedanceFormatted = formatQuoteLine(
      seedanceQuote.estimatedUsdc6,
      seedanceQuote.minCrtvaiWei,
    )

    shotResults.push({
      shotId: mapped.shotId,
      recommendedProvider,
      generate: {
        prompt: mapped.prompt,
        duration: mapped.duration,
        veoDuration: mapped.veoDuration,
        seedanceDuration: mapped.seedanceDuration,
        aspect_ratio: mapped.aspect_ratio,
        resolution: mapped.resolution,
      },
      veo: {
        provider: 'veo',
        duration: mapped.veoDuration,
        ...veoFormatted,
      },
      seedance: {
        provider: 'seedance',
        quoteId: seedanceQuote.quoteId,
        duration: seedanceQuote.duration,
        resolution: seedanceQuote.resolution,
        ...seedanceFormatted,
      },
    })

    storeShots.push({
      shotId: mapped.shotId,
      prompt: mapped.prompt,
      duration: mapped.duration,
      veoDuration: mapped.veoDuration,
      seedanceDuration: mapped.seedanceDuration,
      aspect_ratio: mapped.aspect_ratio,
      resolution: mapped.resolution,
      recommendedProvider,
      veoCrtvaiWei: veoQuote.crtvaiWei.toString(),
      veoUsdc6: veoQuote.estimatedUsdc6,
      seedanceQuoteId: seedanceQuote.quoteId,
      seedanceCrtvaiWei: seedanceQuote.minCrtvaiWei.toString(),
      seedanceUsdc6: seedanceQuote.estimatedUsdc6,
    })
  }

  const stored = await saveDirectorBatchQuote({
    wallet: input.wallet.trim().toLowerCase(),
    storyboardId: input.storyboardId?.trim() || null,
    providerPreference: input.providerPreference ?? null,
    shots: storeShots,
    totals: {
      allVeoCrtvaiWei: allVeoWei.toString(),
      allSeedanceCrtvaiWei: allSeedanceWei.toString(),
      recommendedMixCrtvaiWei: mixWei.toString(),
    },
  })

  const allVeoUsdc6 = shotResults.reduce((sum, shot) => sum + shot.veo.estimatedUsdc6, 0)
  const allSeedanceUsdc6 = shotResults.reduce((sum, shot) => sum + shot.seedance.estimatedUsdc6, 0)

  return {
    ok: true,
    quote: {
      batchQuoteId: stored.batchQuoteId,
      expiresAt: new Date(stored.expiresAtMs).toISOString(),
      shotCount: shotResults.length,
      shots: shotResults,
      totals: {
        allVeo: {
          ...formatQuoteLine(allVeoUsdc6, allVeoWei),
          estimatedUsdc6: allVeoUsdc6,
        },
        allSeedance: {
          ...formatQuoteLine(allSeedanceUsdc6, allSeedanceWei),
          estimatedUsdc6: allSeedanceUsdc6,
        },
        recommendedMix: {
          ...formatQuoteLine(mixUsdc6, mixWei),
          estimatedUsdc6: mixUsdc6,
          providers: { veo: mixVeo, seedance: mixSeedance },
        },
      },
    },
  }
}

export type BatchQuoteBindingResult =
  | { ok: true; totalCrtvaiWei: bigint; shots: DirectorBatchShotQuoteRecord[] }
  | { ok: false; error: 'quote_not_found' | 'wallet_mismatch' | 'selection_mismatch' }

export function bindDirectorBatchSelections(
  quote: { wallet: string; shots: DirectorBatchShotQuoteRecord[] },
  wallet: string,
  selections: Array<{ shotId: string; provider: PixelsRenderProvider }>,
): BatchQuoteBindingResult {
  const normalizedWallet = wallet.trim().toLowerCase()
  if (quote.wallet !== normalizedWallet) {
    return { ok: false, error: 'wallet_mismatch' }
  }

  if (selections.length !== quote.shots.length) {
    return { ok: false, error: 'selection_mismatch' }
  }

  const quoteByShotId = new Map(quote.shots.map((shot) => [shot.shotId, shot]))
  const weiValues: bigint[] = []

  for (const selection of selections) {
    const shotId = selection.shotId.trim()
    const stored = quoteByShotId.get(shotId)
    if (!stored) {
      return { ok: false, error: 'selection_mismatch' }
    }
    if (selection.provider !== 'veo' && selection.provider !== 'seedance') {
      return { ok: false, error: 'selection_mismatch' }
    }
    weiValues.push(
      BigInt(
        selection.provider === 'veo' ? stored.veoCrtvaiWei : stored.seedanceCrtvaiWei,
      ),
    )
  }

  return {
    ok: true,
    totalCrtvaiWei: sumCrtvaiWei(weiValues),
    shots: quote.shots,
  }
}
