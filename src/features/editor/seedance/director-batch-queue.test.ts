import { describe, expect, it } from 'vitest'
import {
  buildBatchSelections,
  countBatchProgress,
  isBatchQuoteExpired,
  prepareJobsForResume,
  resetFailedJobsForRetry,
  runWithConcurrency,
  selectShotsForRetry,
  type DirectorBatchShotJob,
} from './director-batch-queue'
import type { DirectorBatchQuoteResponse } from './seedance-client'
import {
  DIRECTOR_BATCH_CONCURRENCY_DEFAULT,
  resolveDirectorBatchConcurrency,
} from './director-batch-concurrency'
import { parseStoryboardShots } from './parse-storyboard-shots'

const mockQuote = (): DirectorBatchQuoteResponse => ({
  batchQuoteId: 'quote-1',
  expiresAt: new Date().toISOString(),
  shotCount: 2,
  shots: [
    {
      shotId: 'shot-1',
      recommendedProvider: 'veo',
      generate: {
        prompt: 'A',
        duration: 5,
        veoDuration: 6,
        seedanceDuration: 5,
        aspect_ratio: '16:9',
        resolution: '720p',
      },
      veo: {
        provider: 'veo',
        duration: 6,
        estimatedUsdc6: 500_000,
        crtvaiRequired: '1000',
        crtvaiDisplay: 0.5,
        formattedUsd: '$0.50',
        label: 'Veo',
        detail: '',
      },
      seedance: {
        provider: 'seedance',
        duration: 5,
        estimatedUsdc6: 600_000,
        crtvaiRequired: '1200',
        crtvaiDisplay: 0.6,
        formattedUsd: '$0.60',
        label: 'Seedance',
        detail: '',
        quoteId: 'sq-1',
      },
    },
    {
      shotId: 'shot-2',
      recommendedProvider: 'seedance',
      generate: {
        prompt: 'B',
        duration: 6,
        veoDuration: 6,
        seedanceDuration: 6,
        aspect_ratio: '9:16',
        resolution: '720p',
      },
      veo: {
        provider: 'veo',
        duration: 6,
        estimatedUsdc6: 500_000,
        crtvaiRequired: '1000',
        crtvaiDisplay: 0.5,
        formattedUsd: '$0.50',
        label: 'Veo',
        detail: '',
      },
      seedance: {
        provider: 'seedance',
        duration: 6,
        estimatedUsdc6: 700_000,
        crtvaiRequired: '1400',
        crtvaiDisplay: 0.7,
        formattedUsd: '$0.70',
        label: 'Seedance',
        detail: '',
        quoteId: 'sq-2',
      },
    },
  ],
  totals: {
    allVeo: { crtvaiRequired: '2000', crtvaiDisplay: 1, formattedUsd: '$1.00' },
    allSeedance: { crtvaiRequired: '2600', crtvaiDisplay: 1.3, formattedUsd: '$1.30' },
    recommendedMix: {
      crtvaiRequired: '2200',
      crtvaiDisplay: 1.1,
      formattedUsd: '$1.10',
      providers: { veo: 1, seedance: 1 },
    },
  },
})

describe('director batch queue', () => {
  it('defaults concurrency to 20', () => {
    expect(DIRECTOR_BATCH_CONCURRENCY_DEFAULT).toBe(20)
    expect(resolveDirectorBatchConcurrency()).toBe(20)
  })

  it('builds selections for each path', () => {
    const quote = mockQuote()
    expect(buildBatchSelections(quote, 'allVeo').map((s) => s.provider)).toEqual(['veo', 'veo'])
    expect(buildBatchSelections(quote, 'allSeedance').map((s) => s.provider)).toEqual([
      'seedance',
      'seedance',
    ])
    expect(buildBatchSelections(quote, 'recommendedMix').map((s) => s.provider)).toEqual([
      'veo',
      'seedance',
    ])
  })

  it('selects only failed shots for retry', () => {
    const jobs: DirectorBatchShotJob[] = [
      {
        shotId: 'a',
        requestId: 'r1',
        provider: 'veo',
        status: 'succeeded',
        progress: 100,
        generateEndpoint: '/api/pixels-render-veo',
      },
      {
        shotId: 'b',
        requestId: 'r2',
        provider: 'seedance',
        status: 'failed',
        progress: 0,
        generateEndpoint: '/api/seedance-generate',
        error: 'timeout',
      },
      {
        shotId: 'c',
        requestId: 'r3',
        provider: 'veo',
        status: 'running',
        progress: 40,
        generateEndpoint: '/api/pixels-render-veo',
      },
    ]
    expect(selectShotsForRetry(jobs).map((j) => j.shotId)).toEqual(['b'])
    expect(countBatchProgress(jobs)).toEqual({
      completed: 2,
      succeeded: 1,
      failed: 1,
      total: 3,
    })
  })

  it('resets running jobs to queued on resume', () => {
    const jobs: DirectorBatchShotJob[] = [
      {
        shotId: 'a',
        requestId: 'r1',
        provider: 'veo',
        status: 'running',
        progress: 40,
        generateEndpoint: '/api/pixels-render-veo',
      },
      {
        shotId: 'b',
        requestId: 'r2',
        provider: 'seedance',
        status: 'succeeded',
        progress: 100,
        generateEndpoint: '/api/seedance-generate',
      },
    ]
    const prepared = prepareJobsForResume(jobs)
    expect(prepared[0]?.status).toBe('queued')
    expect(prepared[1]?.status).toBe('succeeded')
  })

  it('detects expired batch quotes', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(isBatchQuoteExpired(past)).toBe(true)
    expect(isBatchQuoteExpired(future)).toBe(false)
  })

  it('resets only failed jobs to queued for retry', () => {
    const jobs: DirectorBatchShotJob[] = [
      {
        shotId: 'a',
        requestId: 'r1',
        provider: 'veo',
        status: 'succeeded',
        progress: 100,
        generateEndpoint: '/api/pixels-render-veo',
      },
      {
        shotId: 'b',
        requestId: 'r2',
        provider: 'seedance',
        status: 'failed',
        progress: 0,
        generateEndpoint: '/api/seedance-generate',
        error: 'fail',
      },
    ]
    const reset = resetFailedJobsForRetry(jobs)
    expect(reset[0]?.status).toBe('succeeded')
    expect(reset[1]?.status).toBe('queued')
    expect(reset[1]?.error).toBeUndefined()
  })

  it('caps concurrent workers', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const items = Array.from({ length: 30 }, (_, index) => index)

    await runWithConcurrency(items, 20, async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
    })

    expect(maxInFlight).toBeLessThanOrEqual(20)
    expect(maxInFlight).toBeGreaterThan(1)
  })
})

describe('parseStoryboardShots', () => {
  it('parses markdown sections into shot payloads', () => {
    const markdown = `## Shot 1 — City wide (5s)
Wide city skyline at dusk, cinematic 16:9

## Shot 2 — Hero close-up
Same hero close-up in rain, consistent character, 9:16`

    const shots = parseStoryboardShots(markdown)
    expect(shots).toHaveLength(2)
    expect(shots[0]?.shotId).toBe('shot-1')
    expect(shots[0]?.duration).toBe(5)
    expect(shots[0]?.aspectRatio).toBe('16:9')
    expect(shots[1]?.consistentCharacter).toBe(true)
    expect(shots[1]?.aspectRatio).toBe('9:16')
  })
})
