import type { FlowQuote } from './flow-pricing'

interface FlowServerQuoteResponse {
  crtvaiRequired: string
  crtvaiDisplay: number
  formattedUsd: string
  estimatedUsdc6: number
}

export async function fetchFlowServerQuote(
  auth: { token: string; walletAddress?: string },
  input: {
    duration: number
    quality: string
    tier: string
    stillCount: number
    stillQuality?: string
  },
): Promise<Pick<FlowQuote, 'crtvaiWei' | 'crtvaiDisplay' | 'formattedUsd' | 'estimatedUsdc6'> | null> {
  const response = await fetch('/api/flow-quote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({
      token: auth.token,
      walletAddress: auth.walletAddress,
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
    estimatedUsdc6: data.estimatedUsdc6,
    crtvaiWei: BigInt(data.crtvaiRequired),
    crtvaiDisplay: data.crtvaiDisplay,
    formattedUsd: data.formattedUsd,
  }
}
