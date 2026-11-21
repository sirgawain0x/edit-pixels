import { describe, expect, it } from 'vitest'
import {
  buildBatchSelections,
  countBatchProgress,
  isBatchQuoteExpired,
  prepareJobsForResume,
  resetFailedJobsForRetry,
  runBatchJobsByProvider,
  runWithConcurrency,
  selectShotsForRetry,
  splitQueuedJobsByProvider,
  totalCrtvaiForPath,
  type DirectorBatchShotJob,
} from './director-batch-queue'
import type { DirectorBatchQuoteResponse } from './seedance-client'
import {
  DIRECTOR_BATCH_SEEDANCE_CONCURRENCY_DEFAULT,
  resolveDirectorBatchSeedanceConcurrency,
  resolveDirectorBatchVeoConcurrency,
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
        omniDuration: 5,
        veoDuration: 6,
        seedanceDuration: 5,
        aspect_ratio: '16:9',
        resolution: '720p',
      },
      omni: {
        provider: 'omni',
        duration: 5,
        estimatedUsdc6: 400_000,
        crtvaiRequired: '800000000000000000',
        crtvaiDisplay: 0.8,
        formattedUsd: '$0.40',
        label: 'Gemini Omni 1.2 Flash',
        detail: '',
      },
      veo: {
        provider: 'veo',
        duration: 6,
        estimatedUsdc6: 500_000,
        crtvaiRequired: '1000000000000000000',
        crtvaiDisplay: 1,
        formattedUsd: '$0.50',
        label: 'Veo',
        detail: '',
      },
      seedance: {
        provider: 'seedance',
        duration: 5,
        estimatedUsdc6: 600_000,
        crtvaiRequired: '1200000000000000000',
        crtvaiDisplay: 1.2,
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
        omniDuration: 6,
        veoDuration: 6,
        seedanceDuration: 6,
        aspect_ratio: '9:16',
        resolution: '720p',
      },
      omni: {
        provider: 'omni',
        duration: 6,
        estimatedUsdc6: 500_000,
        crtvaiRequired: '1000000000000000000',
        crtvaiDisplay: 1,
        formattedUsd: '$0.50',
        label: 'Gemini Omni 1.2 Flash',
        detail: '',
      },
      veo: {
        provider: 'veo',
        duration: 6,
        estimatedUsdc6: 500_000,
        crtvaiRequired: '1000000000000000000',
        crtvaiDisplay: 1,
        formattedUsd: '$0.50',
        label: 'Veo',
        detail: '',
      },
      seedance: {
        provider: 'seedance',
        duration: 6,
        estimatedUsdc6: 700_000,
        crtvaiRequired: '1400000000000000000',
        crtvaiDisplay: 1.4,
        formattedUsd: '$0.70',
        label: 'Seedance',
        detail: '',
        quoteId: 'sq-2',
      },
    },
  ],
  totals: {
    allOmni: {
      crtvaiRequired: '1800000000000000000',
      crtvaiDisplay: 1.8,
      formattedUsd: '$0.90',
    },
    allVeo: {
      crtvaiRequired: '2000000000000000000',
      crtvaiDisplay: 2,
      formattedUsd: '$1.00',
    },
    allSeedance: {
      crtvaiRequired: '2600000000000000000',
      crtvaiDisplay: 2.6,
      formattedUsd: '$1.30',
    },
    recommendedMix: {
      crtvaiRequired: '2400000000000000000',
      crtvaiDisplay: 2.4,
      formattedUsd: '$1.20',
      providers: { veo: 1, seedance: 1 },
    },
  },
})

function makeJob(
  shotId: string,
  provider: DirectorBatchShotJob['provider'],
  status: DirectorBatchShotJob['status'] = 'queued',
): DirectorBatchShotJob {
  return {
    shotId,
    requestId: `req-${shotId}`,
    provider,
    status,
    progress: 0,
    generateEndpoint:
      provider === 'seedance'
        ? '/api/seedance-generate'
        : provider === 'omni'
          ? '/api/pixels-render-omni'
          : '/api/pixels-render-veo',
  }
}

describe('director batch queue', () => {
  it('defaults Seedance concurrency to 20; Veo is uncapped by batch size', () => {
    expect(DIRECTOR_BATCH_SEEDANCE_CONCURRENCY_DEFAULT).toBe(20)
    expect(resolveDirectorBatchSeedanceConcurrency()).toBe(20)
    expect(resolveDirectorBatchVeoConcurrency(30)).toBe(30)
    expect(resolveDirectorBatchVeoConcurrency(0)).toBe(0)
  })

  it('builds selections for each path', () => {
    const quote = mockQuote()
    expect(buildBatchSelections(quote, 'allOmni').map((s) => s.provider)).toEqual(['omni', 'omni'])
    expect(buildBatchSelections(quote, 'allVeo').map((s) => s.provider)).toEqual(['veo', 'veo'])
    expect(buildBatchSelections(quote, 'allSeedance').map((s) => s.provider)).toEqual([
      'seedance',
      'seedance',
    ])
    expect(buildBatchSelections(quote, 'recommendedMix').map((s) => s.provider)).toEqual([
      'veo',
      'seedance',
    ])
    expect(totalCrtvaiForPath(quote, 'allOmni').formattedUsd).toBe('$0.90')
    expect(totalCrtvaiForPath(quote, 'allVeo', { 'shot-1': 'omni' })).toEqual({
      crtvaiRequired: '1800000000000000000',
      crtvaiDisplay: 1.8,
      formattedUsd: '$0.90',
    })
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

  it('caps Seedance workers at 20 but not Veo or Omni in multi-pool enqueue', async () => {
    const seedanceJobs = Array.from({ length: 30 }, (_, index) => makeJob(`s${index}`, 'seedance'))
    const veoJobs = Array.from({ length: 30 }, (_, index) => makeJob(`v${index}`, 'veo'))
    const omniJobs = Array.from({ length: 12 }, (_, index) => makeJob(`o${index}`, 'omni'))
    const jobs = [...seedanceJobs, ...veoJobs, ...omniJobs]

    const { seedance, veo, omni } = splitQueuedJobsByProvider(jobs)
    expect(seedance).toHaveLength(30)
    expect(veo).toHaveLength(30)
    expect(omni).toHaveLength(12)

    let seedanceInFlight = 0
    let veoInFlight = 0
    let omniInFlight = 0
    let maxSeedanceInFlight = 0
    let maxVeoInFlight = 0
    let maxOmniInFlight = 0

    await runBatchJobsByProvider(jobs, { seedance: 20, veo: 30, omni: 12 }, async (job) => {
      if (job.provider === 'seedance') {
        seedanceInFlight += 1
        maxSeedanceInFlight = Math.max(maxSeedanceInFlight, seedanceInFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        seedanceInFlight -= 1
      } else if (job.provider === 'omni') {
        omniInFlight += 1
        maxOmniInFlight = Math.max(maxOmniInFlight, omniInFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        omniInFlight -= 1
      } else {
        veoInFlight += 1
        maxVeoInFlight = Math.max(maxVeoInFlight, veoInFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        veoInFlight -= 1
      }
    })

    expect(maxSeedanceInFlight).toBeLessThanOrEqual(20)
    expect(maxSeedanceInFlight).toBeGreaterThan(1)
    expect(maxVeoInFlight).toBe(30)
    expect(maxOmniInFlight).toBe(12)
  })

  it('caps generic worker pool when limit is set', async () => {
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

  it('parses timecode ranges into start and end seconds', () => {
    const markdown = `## Shot 1 — Intro (0:00–0:05)
Wide city skyline at dusk

## Shot 2 — Verse (0:05–0:15)
Hero walks through rain`
    const shots = parseStoryboardShots(markdown)
    expect(shots[0]?.startSeconds).toBe(0)
    expect(shots[0]?.endSeconds).toBe(5)
    expect(shots[0]?.duration).toBe(5)
    expect(shots[1]?.startSeconds).toBe(5)
    expect(shots[1]?.endSeconds).toBe(15)
  })

  it('parses structured Creative Director scenes (#### Scene N + visual_prompt fields)', () => {
    const markdown = `### Detailed Shot Prompts (Veo-Ready)

#### Scene 1: Intro — The Industrial Outskirts
* **scene_index**: 1
* **timestamp_start**: \`00:00\` | **timestamp_end**: \`00:15\` | **duration_seconds**: 15.00
* **camera_movement**: Slow ground-level tracking shot rising smoothly into a low-angle medium profile
* **lighting**: Cold industrial mercury-vapor blue backlight contrasting against warm distant sodium streetlight pools
* **visual_prompt**: Cinematic 35mm anamorphic film capture of a focused young man in his mid-20s. No text, no logos.

#### Scene 2: Verse 1A — The Rain-Slick Alleyway
* **scene_index**: 2
* **timestamp_start**: \`00:15\` | **timestamp_end**: \`00:29\` | **duration_seconds**: 14.00
* **camera_movement**: Steadicam backwards tracking shot maintaining medium close-up as subject advances
* **lighting**: Deep sodium-vapor orange from overhead alley armatures casting hard rim light on wet brick
* **visual_prompt**: Eye-level Steadicam tracking backwards through a narrow brick alleyway.

#### Scene 10: Outro — First Light on the Parapet
* **scene_index**: 10
* **timestamp_start**: \`02:14\` | **timestamp_end**: \`02:28.23\` | **duration_seconds**: 14.23
* **camera_movement**: Slow, majestic dolly-out
* **lighting**: Soft golden dawn
* **visual_prompt**: Elegant 35mm slow dolly-out shot.

---

### Next Step
Please review the storyboard.
`
    const shots = parseStoryboardShots(markdown)
    expect(shots.map((shot) => shot.shotId)).toEqual(['shot-1', 'shot-2', 'shot-10'])
    expect(shots[0]).toMatchObject({ duration: 15, startSeconds: 0, endSeconds: 15 })
    expect(shots[0]?.prompt).toMatch(/^Cinematic 35mm anamorphic/)
    expect(shots[0]?.prompt).toContain('Camera movement: Slow ground-level tracking')
    expect(shots[0]?.prompt).toContain('Lighting: Cold industrial mercury-vapor')
    // Metadata lines must not leak into the prompt.
    expect(shots[0]?.prompt).not.toContain('scene_index')
    expect(shots[0]?.prompt).not.toContain('timestamp_start')
    expect(shots[2]).toMatchObject({ duration: 14, startSeconds: 134, endSeconds: 148.23 })
    // "### Next Step" after the rule is not part of the last scene.
    expect(shots[2]?.prompt).not.toContain('Please review')
  })
})
