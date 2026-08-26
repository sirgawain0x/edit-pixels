/**
 * Flow (start/end → video) pricing — credits → USDC6 → CRTVAI wei.
 */

import {
  quoteNanobananaCredits,
  quoteSeedanceCredits,
  type NanobananaQuality,
  type SeedanceQuality,
  type SeedanceSpeed,
} from '@/config/credits'
import { usdc6ToMetokenWei } from '@/config/metoken'
import { clampFlowDuration } from '@/config/flow'

/** $0.10 USDC per credit (legacy Flow retail). */
export const FLOW_USDC6_PER_CREDIT = 100_000

export interface FlowQuoteInput {
  duration: number
  quality: SeedanceQuality
  speed: SeedanceSpeed
  generateAudio: boolean
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
  crtvaiWei: bigint
  crtvaiDisplay: number
  formattedUsd: string
}

export function quoteFlowGeneration(input: FlowQuoteInput): FlowQuote {
  const duration = clampFlowDuration(input.duration)
  const stillQuality = input.stillQuality ?? '2K'
  const stillCount = Math.min(2, Math.max(0, Math.floor(input.stillCount)))
  const videoCredits = quoteSeedanceCredits({
    duration,
    quality: input.quality,
    speed: input.speed,
    generateAudio: input.generateAudio,
  })
  const stillCredits = stillCount > 0 ? stillCount * quoteNanobananaCredits(stillQuality) : 0
  const totalCredits = videoCredits + stillCredits
  const estimatedUsdc6 = totalCredits * FLOW_USDC6_PER_CREDIT
  const crtvaiWei = usdc6ToMetokenWei(estimatedUsdc6)
  const crtvaiDisplay = Number(crtvaiWei) / 1e18

  return {
    duration,
    videoCredits,
    stillCredits,
    totalCredits,
    estimatedUsdc6,
    crtvaiWei,
    crtvaiDisplay,
    formattedUsd: `$${(estimatedUsdc6 / 1_000_000).toFixed(2)}`,
  }
}
