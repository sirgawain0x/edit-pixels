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
    expect(quote.crtvaiWei).toBe(0n)
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

  it('prices Gemini Omni 1.2 Flash across 360p/720p/1080p/4K and allows 10s duration', () => {
    const q360 = quoteFlowGeneration({
      duration: 10,
      quality: '360p',
      tier: 'omni',
      stillCount: 0,
    })
    const q720 = quoteFlowGeneration({
      duration: 10,
      quality: '720p',
      tier: 'omni',
      stillCount: 0,
    })
    const q1080 = quoteFlowGeneration({
      duration: 10,
      quality: '1080p',
      tier: 'omni',
      stillCount: 0,
    })
    const q4k = quoteFlowGeneration({
      duration: 10,
      quality: '4K',
      tier: 'omni',
      stillCount: 0,
    })
    const veoStandard10 = quoteFlowGeneration({
      duration: 10,
      quality: '720p',
      tier: 'standard',
      stillCount: 0,
    })

    expect(q720.duration).toBe(10)
    expect(veoStandard10.duration).toBe(8)
    expect(q360.videoCredits).toBeLessThan(q720.videoCredits)
    expect(q720.videoCredits).toBeLessThan(q1080.videoCredits)
    expect(q1080.videoCredits).toBeLessThan(q4k.videoCredits)
    expect(q720.videoCredits).toBeLessThan(veoStandard10.videoCredits)
  })
})
