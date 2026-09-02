import { describe, expect, it } from 'vitest'
import { quoteFlowGeneration } from './flow-pricing'

describe('quoteFlowGeneration', () => {
  it('quotes video-only Flow without stills', () => {
    const quote = quoteFlowGeneration({
      duration: 8,
      quality: '720p',
      tier: 'standard',
      stillCount: 0,
    })
    expect(quote.stillCredits).toBe(0)
    expect(quote.videoCredits).toBe(32)
    expect(quote.totalCredits).toBe(quote.videoCredits)
    expect(quote.estimatedUsdc6).toBe(quote.totalCredits * 100_000)
    expect(quote.crtvaiWei).toBeGreaterThan(0n)
  })

  it('adds Gemini still credits', () => {
    const base = quoteFlowGeneration({
      duration: 8,
      quality: '720p',
      tier: 'lite',
      stillCount: 0,
    })
    const withStills = quoteFlowGeneration({
      duration: 8,
      quality: '720p',
      tier: 'lite',
      stillCount: 2,
      stillQuality: '2K',
    })
    expect(withStills.stillCredits).toBe(2)
    expect(withStills.totalCredits).toBe(base.videoCredits + 2)
  })

  it('quotes lite tier lower than standard', () => {
    const lite = quoteFlowGeneration({
      duration: 8,
      quality: '720p',
      tier: 'lite',
      stillCount: 0,
    })
    const standard = quoteFlowGeneration({
      duration: 8,
      quality: '720p',
      tier: 'standard',
      stillCount: 0,
    })
    expect(lite.videoCredits).toBeLessThan(standard.videoCredits)
  })
})
