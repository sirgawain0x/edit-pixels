/**
 * Creative Pixels render providers — multi-provider USD quotes; meToken from server APIs.
 */
// fallow-ignore-file unused-export

import { clampFlowDuration, type FlowQuality, type FlowTier } from '@/config/flow'
import {
  clampOmniDuration,
  quoteNanobananaCredits,
  quoteOmniCredits,
  quoteVeoCredits,
  normalizeVeoQuality,
  type OmniQuality,
} from '@/config/credits'
import {
  quoteSeedanceGeneration,
  type SeedanceQuote,
  type SeedanceResolution,
} from '@/config/seedance'

const FLOW_USDC6_PER_CREDIT = 100_000

export type PixelsRenderProvider = 'omni' | 'veo' | 'seedance'

export const PIXELS_VEO_TIER: FlowTier = 'standard'
export const PIXELS_VEO_QUALITY: FlowQuality = '720p'
export const PIXELS_OMNI_QUALITY: OmniQuality = '720p'

export interface PixelsOmniRenderQuote {
  provider: 'omni'
  duration: number
  stillCount: 0
  estimatedUsdc6: number
  crtvaiWei: bigint
  crtvaiDisplay: number
  formattedUsd: string
  label: string
  detail: string
}

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

export type PixelsRenderQuote =
  | PixelsOmniRenderQuote
  | PixelsVeoRenderQuote
  | PixelsSeedanceRenderQuote

export function quotePixelsOmniRender(duration: number): PixelsOmniRenderQuote {
  const clampedDuration = clampOmniDuration(duration)
  const totalCredits = quoteOmniCredits({
    duration: clampedDuration,
    quality: PIXELS_OMNI_QUALITY,
  })
  const estimatedUsdc6 = totalCredits * FLOW_USDC6_PER_CREDIT

  return {
    provider: 'omni',
    duration: clampedDuration,
    stillCount: 0,
    estimatedUsdc6,
    crtvaiWei: 0n,
    crtvaiDisplay: 0,
    formattedUsd: `$${(estimatedUsdc6 / 1_000_000).toFixed(2)}`,
    label: 'Gemini Omni 1.2 Flash',
    detail: 'Fast text-to-video with native audio (best value)',
  }
}

export function quotePixelsVeoRender(duration: number): PixelsVeoRenderQuote {
  const clampedDuration = clampFlowDuration(duration)
  const quality = normalizeVeoQuality('720p', 'standard')
  const videoCredits = quoteVeoCredits({
    duration: clampedDuration,
    quality,
    tier: 'standard',
  })
  const stillCredits = quoteNanobananaCredits('2K')
  const totalCredits = videoCredits + stillCredits
  const estimatedUsdc6 = totalCredits * FLOW_USDC6_PER_CREDIT

  return {
    provider: 'veo',
    duration: clampedDuration,
    stillCount: 1,
    estimatedUsdc6,
    crtvaiWei: 0n,
    crtvaiDisplay: 0,
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
  return [
    quotePixelsOmniRender(duration),
    quotePixelsVeoRender(duration),
    quotePixelsSeedanceRender(duration, resolution),
  ]
}

export function quotePixelsRender(
  provider: PixelsRenderProvider,
  duration: number,
  resolution: SeedanceResolution,
): PixelsRenderQuote {
  if (provider === 'omni') return quotePixelsOmniRender(duration)
  return provider === 'veo'
    ? quotePixelsVeoRender(duration)
    : quotePixelsSeedanceRender(duration, resolution)
}
