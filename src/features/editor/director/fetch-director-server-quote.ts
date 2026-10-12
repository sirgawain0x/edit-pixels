import type { DirectorQuote } from './director-pricing'
import { formatAudioDurationLabel, billableAudioMinutes } from './director-pricing'
import {
  DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM,
  DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL,
} from '@/config/billing'

interface DirectorServerQuoteResponse {
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

export async function fetchDirectorServerQuote(
  auth: { token: string; walletAddress?: string },
  input: { audioDurationSeconds: number },
): Promise<DirectorQuote | null> {
  const response = await fetch('/api/director-quote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({
      token: auth.token,
      walletAddress: auth.walletAddress,
      audioDurationSeconds: input.audioDurationSeconds,
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
