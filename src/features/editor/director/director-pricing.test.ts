import { describe, expect, it } from 'vitest'
import {
  billableAudioMinutes,
  quoteDirectorBrief,
  quoteDirectorBriefRetail,
} from './director-pricing'
import {
  DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM,
  DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL,
} from '@/config/billing'

describe('billableAudioMinutes', () => {
  it('returns 0 for missing audio', () => {
    expect(billableAudioMinutes(0)).toBe(0)
    expect(billableAudioMinutes(-1)).toBe(0)
  })

  it('ceil-rounds partial minutes with a 1-minute floor', () => {
    expect(billableAudioMinutes(1)).toBe(1)
    expect(billableAudioMinutes(60)).toBe(1)
    expect(billableAudioMinutes(61)).toBe(2)
    expect(billableAudioMinutes(180)).toBe(3)
  })
})

describe('quoteDirectorBrief', () => {
  it('returns null without audio duration', () => {
    expect(quoteDirectorBrief({ audioDurationSeconds: 0 })).toBeNull()
  })

  it('prices retail per billable minute of audio', () => {
    const quote = quoteDirectorBrief({ audioDurationSeconds: 90 })
    expect(quote).not.toBeNull()
    expect(quote!.billableMinutes).toBe(2)
    expect(quote!.tier).toBe('retail')
    expect(quote!.estimatedUsdc6).toBe(2 * DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL)
    expect(quote!.formattedUsd).toBe('$0.10')
    expect(quote!.crtvaiWei).toBeGreaterThan(0n)
  })

  it('applies premium rate when requested', () => {
    const quote = quoteDirectorBrief({ audioDurationSeconds: 60, isPremium: true })
    expect(quote!.tier).toBe('premium')
    expect(quote!.estimatedUsdc6).toBe(DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM)
  })

  it('retail helper ignores premium', () => {
    const quote = quoteDirectorBriefRetail(60)
    expect(quote!.estimatedUsdc6).toBe(DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL)
  })
})
