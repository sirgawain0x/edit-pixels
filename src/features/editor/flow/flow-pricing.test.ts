import { describe, expect, it } from 'vitest'
import { quoteFlowGeneration } from './flow-pricing'

describe('quoteFlowGeneration', () => {
  it('quotes video-only Flow without stills', () => {
    const quote = quoteFlowGeneration({
      duration: 5,
      quality: '720p',
      speed: 'standard',
      generateAudio: true,
      stillCount: 0,
    })
    expect(quote.stillCredits).toBe(0)
    expect(quote.videoCredits).toBeGreaterThan(0)
    expect(quote.totalCredits).toBe(quote.videoCredits)
    expect(quote.estimatedUsdc6).toBe(quote.totalCredits * 100_000)
    expect(quote.crtvaiWei).toBeGreaterThan(0n)
  })

  it('adds Gemini still credits', () => {
    const base = quoteFlowGeneration({
      duration: 5,
      quality: '720p',
      speed: 'standard',
      generateAudio: false,
      stillCount: 0,
    })
    const withStills = quoteFlowGeneration({
      duration: 5,
      quality: '720p',
      speed: 'standard',
      generateAudio: false,
      stillCount: 2,
      stillQuality: '2K',
    })
    expect(withStills.stillCredits).toBe(24)
    expect(withStills.totalCredits).toBe(base.videoCredits + 24)
  })
})

