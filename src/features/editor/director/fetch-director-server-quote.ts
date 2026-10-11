import type { DirectorQuote } from './director-pricing'
import {
  estimateDirectorUsdc6,
  formatAudioDurationLabel,
  billableAudioMinutes,
} from './director-pricing'
import {
  DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM,
  DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL,
} from '@/config/billing'

export interface DirectorServerQuoteResponse {
  quoteId: string
  signature: string
  expiresAtMs: number
  slippageBps: number
  billableMinutes: number
  estimatedUsdc6: number
  formattedUsd: string
  crtvaiRequired: string
  crtvaiDisplay: number
  tier: 'premium' | 'retail'
  audioDurationSeconds: number
}

export async function fetchDirectorServerQuote(input: {
  audioDurationSeconds: number
  walletAddress?: string
}): Promise<DirectorQuote | null> {
  const response = await fetch('/api/director-quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioDurationSeconds: input.audioDurationSeconds,
      walletAddress: input.walletAddress,
    }),
  })
  if (!response.ok) return null
  const data = (await response.json()) as DirectorServerQuoteResponse
  const isPremium = data.tier === 'premium'
  const usdc6PerMinute = isPremium
    ? DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM
    : DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL

  return {
    audioDurationSeconds: input.audioDurationSeconds,
    billableMinutes: data.billableMinutes ?? billableAudioMinutes(input.audioDurationSeconds),
    usdc6PerMinute,
    estimatedUsdc6: data.estimatedUsdc6,
    crtvaiWei: BigInt(data.crtvaiRequired),
    crtvaiDisplay: data.crtvaiDisplay,
    formattedUsd: data.formattedUsd,
    formattedDuration: formatAudioDurationLabel(input.audioDurationSeconds),
    tier: data.tier,
    quoteId: data.quoteId,
    signature: data.signature,
    expiresAtMs: data.expiresAtMs,
    slippageBps: data.slippageBps,
  }
}

/** USD-only estimate for UI hints before the server quote returns. */
export function estimateDirectorUsdQuote(
  audioDurationSeconds: number,
  isPremium: boolean,
): Pick<DirectorQuote, 'estimatedUsdc6' | 'formattedUsd' | 'formattedDuration' | 'tier'> | null {
  const minutes = billableAudioMinutes(audioDurationSeconds)
  if (minutes <= 0) return null
  const usdc6PerMinute = isPremium
    ? DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM
    : DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL
  const estimatedUsdc6 = estimateDirectorUsdc6(audioDurationSeconds, usdc6PerMinute)
  if (estimatedUsdc6 <= 0) return null
  return {
    estimatedUsdc6,
    formattedUsd: `$${(estimatedUsdc6 / 1_000_000).toFixed(2)}`,
    formattedDuration: formatAudioDurationLabel(audioDurationSeconds),
    tier: isPremium ? 'premium' : 'retail',
  }
}
