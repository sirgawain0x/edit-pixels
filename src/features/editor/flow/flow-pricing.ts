/**
 * Flow (start/end → video) pricing — credits → USDC6 list price (server quotes meToken at checkout).
 */
// fallow-ignore-file unused-export

import {
  quoteNanobananaCredits,
  quoteVeoCredits,
  normalizeVeoQuality,
  type NanobananaQuality,
  type VeoQuality,
  type VeoTier,
} from '@/config/credits'
import { clampFlowDuration } from '@/config/flow'

/** $0.10 USDC per credit (legacy Flow retail). */
export const FLOW_USDC6_PER_CREDIT = 100_000

export interface FlowQuoteInput {
  duration: number
  quality: VeoQuality
  tier: VeoTier
  /** How many Gemini stills to generate (0–2). Uploaded frames cost 0. */
  stillCount: number
  stillQuality?: NanobananaQuality
}

export interface FlowQuote {
  duration: number
  videoCredits: number
  stillCredits: number
  totalCredits: number
  estimatedUsdc6: number
  /** Populated from server responses only. */
  crtvaiWei: bigint
  crtvaiDisplay: number
  formattedUsd: string
}

export function quoteFlowGeneration(input: FlowQuoteInput): FlowQuote {
  const duration = clampFlowDuration(input.duration)
  const stillQuality = input.stillQuality ?? '2K'
  const stillCount = Math.min(2, Math.max(0, Math.floor(input.stillCount)))
  const quality = normalizeVeoQuality(input.quality, input.tier)
  const videoCredits = quoteVeoCredits({
    duration,
    quality,
    tier: input.tier,
  })
  const stillCredits = stillCount > 0 ? stillCount * quoteNanobananaCredits(stillQuality) : 0
  const totalCredits = videoCredits + stillCredits
  const estimatedUsdc6 = totalCredits * FLOW_USDC6_PER_CREDIT

  return {
    duration,
    videoCredits,
    stillCredits,
    totalCredits,
    estimatedUsdc6,
    crtvaiWei: 0n,
    crtvaiDisplay: 0,
    formattedUsd: `$${(estimatedUsdc6 / 1_000_000).toFixed(2)}`,
  }
}
