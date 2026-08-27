import { describe, expect, it } from 'vitest'
import {
  billableAudioMinutes,
  estimateDirectorUsdc6,
  formatAudioDurationLabel,
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

  it('uses exact fractional minutes from seconds', () => {
    expect(billableAudioMinutes(1)).toBeCloseTo(1 / 60)
    expect(billableAudioMinutes(60)).toBe(1)
    expect(billableAudioMinutes(250)).toBeCloseTo(250 / 60)
    expect(billableAudioMinutes(180)).toBe(3)
  })
})

describe('formatAudioDurationLabel', () => {
  it('formats minutes and seconds', () => {
    expect(formatAudioDurationLabel(250)).toBe('4m 10s')
    expect(formatAudioDurationLabel(60)).toBe('1m')
    expect(formatAudioDurationLabel(45)).toBe('45s')
  })
})

describe('quoteDirectorBrief', () => {
  it('returns null without audio duration', () => {
    expect(quoteDirectorBrief({ audioDurationSeconds: 0 })).toBeNull()
  })

  it('prorates retail cost by exact audio seconds', () => {
    const quote = quoteDirectorBrief({ audioDurationSeconds: 90 })
    expect(quote).not.toBeNull()
    expect(quote!.billableMinutes).toBe(1.5)
    expect(quote!.tier).toBe('retail')
    expect(quote!.estimatedUsdc6).toBe(
      estimateDirectorUsdc6(90, DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL),
    )
    expect(quote!.estimatedUsdc6).toBe(
      Math.round((90 * DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL) / 60),
    )
    expect(quote!.formattedUsd).toBe('$0.07')
  })

  it('charges 250s as ~4m 10s not a rounded-up 5 minutes', () => {
    const quote = quoteDirectorBrief({ audioDurationSeconds: 250 })
    expect(quote!.formattedDuration).toBe('4m 10s')
    expect(quote!.billableMinutes).toBeCloseTo(4 + 10 / 60)
    // Not ceil(250/60)=5 → $0.25
    expect(quote!.estimatedUsdc6).toBe(
      Math.round((250 * DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL) / 60),
    )
    expect(quote!.estimatedUsdc6).toBe(208_333)
    expect(quote!.formattedUsd).toBe('$0.21')
    expect(quote!.crtvaiDisplay).toBeCloseTo(0.208333, 5)
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
