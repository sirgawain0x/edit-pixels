/**
 * Creative Pixels render providers — dual CRTVAI quotes before spend.
 */
// fallow-ignore-file unused-export

import { clampFlowDuration, type FlowQuality, type FlowTier } from '@/config/flow'
import { quoteNanobananaCredits, quoteVeoCredits, normalizeVeoQuality } from '@/config/credits'
import { usdc6ToMetokenWei } from '@/config/metoken'
import {
  quoteSeedanceGeneration,
  type SeedanceQuote,
  type SeedanceResolution,
} from '@/config/seedance'

const FLOW_USDC6_PER_CREDIT = 100_000

export type PixelsRenderProvider = 'veo' | 'seedance'

export const PIXELS_VEO_TIER: FlowTier = 'standard'
export const PIXELS_VEO_QUALITY: FlowQuality = '720p'

export interface PixelsVeoRenderQuote {
  provider: 'veo'
  duration: number
  stillCount: 1
  estimatedUsdc6: number
  crtvaiWei: bigint
  crtvaiDisplay: number
  formattedUsd: string
  label: string
  detail: string
}

export interface PixelsSeedanceRenderQuote extends SeedanceQuote {
  provider: 'seedance'
  label: string
  detail: string
}

export type PixelsRenderQuote = PixelsVeoRenderQuote | PixelsSeedanceRenderQuote

export function quotePixelsVeoRender(duration: number): PixelsVeoRenderQuote {
  const clampedDuration = clampFlowDuration(duration)
  const quality = normalizeVeoQuality(PIXELS_VEO_QUALITY, PIXELS_VEO_TIER)
  const videoCredits = quoteVeoCredits({
    duration: clampedDuration,
    quality,
    tier: PIXELS_VEO_TIER,
  })
  const stillCredits = quoteNanobananaCredits('2K')
  const totalCredits = videoCredits + stillCredits
  const estimatedUsdc6 = totalCredits * FLOW_USDC6_PER_CREDIT
  const crtvaiWei = usdc6ToMetokenWei(estimatedUsdc6)
  const crtvaiDisplay = Number(crtvaiWei) / 1e18

  return {
    provider: 'veo',
    duration: clampedDuration,
    stillCount: 1,
    estimatedUsdc6,
    crtvaiWei,
    crtvaiDisplay,
    formattedUsd: `$${(estimatedUsdc6 / 1_000_000).toFixed(2)}`,
    label: 'Google Veo 3.1',
    detail: 'Gemini still + Veo image-to-video',
  }
}

export function quotePixelsSeedanceRender(
  duration: number,
  resolution: SeedanceResolution,
): PixelsSeedanceRenderQuote {
  const seedance = quoteSeedanceGeneration({ duration, resolution })
  return {
    ...seedance,
    provider: 'seedance',
    label: 'Higgsfield Seedance 2.5',
    detail: 'Text-to-video (character consistency)',
  }
}

export function quotePixelsRenderOptions(
  duration: number,
  resolution: SeedanceResolution,
): PixelsRenderQuote[] {
  return [quotePixelsVeoRender(duration), quotePixelsSeedanceRender(duration, resolution)]
}

export function quoteForProvider(
  provider: PixelsRenderProvider,
  duration: number,
  resolution: SeedanceResolution,
): PixelsRenderQuote {
  return provider === 'veo'
    ? quotePixelsVeoRender(duration)
    : quotePixelsSeedanceRender(duration, resolution)
}
