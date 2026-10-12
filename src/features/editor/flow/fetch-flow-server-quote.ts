import type { FlowQuote } from './flow-pricing'
import type { FlowTier } from '@/config/flow'
import type { VeoQuality } from '@/config/credits'
import type { NanobananaQuality } from '@/config/credits'

interface FlowServerQuoteResponse {
  quoteId: string
  signature: string
  expiresAtMs: number
  slippageBps: number
  duration: number
  quality: VeoQuality
  tier: FlowTier
  stillCount: number
  videoCredits: number
  stillCredits: number
  totalCredits: number
  estimatedUsdc6: number
  formattedUsd: string
  crtvaiRequired: string
  crtvaiDisplay: number
}

export async function fetchFlowServerQuote(input: {
  duration: number
  quality: VeoQuality
  tier: FlowTier
  stillCount: number
  stillQuality?: NanobananaQuality
}): Promise<FlowQuote | null> {
  const response = await fetch('/api/flow-quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      duration: input.duration,
      quality: input.quality,
      tier: input.tier,
      stillCount: input.stillCount,
      stillQuality: input.stillQuality ?? '2K',
    }),
  })
  if (!response.ok) return null
  const data = (await response.json()) as FlowServerQuoteResponse

  return {
    duration: data.duration,
    videoCredits: data.videoCredits,
    stillCredits: data.stillCredits,
    totalCredits: data.totalCredits,
    estimatedUsdc6: data.estimatedUsdc6,
    crtvaiWei: BigInt(data.crtvaiRequired),
    crtvaiDisplay: data.crtvaiDisplay,
    formattedUsd: data.formattedUsd,
    quoteId: data.quoteId,
    signature: data.signature,
    expiresAtMs: data.expiresAtMs,
    slippageBps: data.slippageBps,
  }
}
