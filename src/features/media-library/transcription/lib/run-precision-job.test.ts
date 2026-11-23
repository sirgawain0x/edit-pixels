import { describe, expect, it, vi } from 'vitest'
import type { MediaTranscript } from '@/types/storage'
import {
  IncompleteTranscriptError,
  PrecisionPartError,
  runPrecisionJob,
  type PrecisionDeps,
  type PrecisionPlan,
  type PrecisionStage,
} from './run-precision-job'

const MODEL = 'gemini-3.5-transcribe' as const

/** Two parts, the second overlapping the first by one second. */
const PLAN: PrecisionPlan = {
  sourceDurationSec: 30,
  parts: [
    { startSec: 0, endSec: 20, overlapSec: 1 },
    { startSec: 19, endSec: 30, overlapSec: 0 },
  ],
}

function words(...entries: Array<[string, number, number]>) {
  return entries.map(([word, startSeconds, endSeconds]) => ({ word, startSeconds, endSeconds }))
}

const savedTranscript = { id: 'tr-1', mediaId: 'media-1' } as unknown as MediaTranscript

/**
 * A dependency set that records what was called, in order, so the sequence can be asserted
 * rather than assumed. Individual tests override the one piece they care about.
 */
function makeDeps(overrides: Partial<PrecisionDeps> = {}) {
  const calls: string[] = []
  const stages: PrecisionStage[] = []

  const deps: PrecisionDeps = {
    plan: vi.fn(async () => {
      calls.push('plan')
      return PLAN
    }),
    quote: vi.fn(async () => {
      calls.push('quote')
      return { jobId: 'job-1', free: false, priceUsd: 0.3 }
    }),
    pay: vi.fn(async () => {
      calls.push('pay')
      return '0xfeed'
    }),
    upload: vi.fn(async (_jobId: string, parts: PrecisionPlan['parts']) => {
      calls.push('upload')
      return parts.map((_part, index) => ({ index, uri: `gs://b/input/a/job-1/part-${index}.wav` }))
    }),
    submit: vi.fn(async () => {
      calls.push('submit')
    }),
    transcribePart: vi.fn(async ({ partIndex }: { partIndex: number }) => {
      calls.push(`part-${partIndex}`)
      // The second part repeats the tail of the first, which the merge must dedupe.
      // Parts overlap 19.0-20.0, so "b" arrives twice: at 19.2 absolute in the first part,
      // and at 0.2 relative (19.2 absolute) in the second. Offsets stay part-relative here.
      return partIndex === 0
        ? {
            segments: [
              { speakerLabel: 'spk:0', text: 'a b', words: words(['a', 0, 1], ['b', 19.2, 20]) },
            ],
          }
        : {
            segments: [
              { speakerLabel: 'spk:0', text: 'b c', words: words(['b', 0.2, 1], ['c', 1, 2]) },
            ],
          }
    }),
    save: vi.fn(async () => {
      calls.push('save')
      return savedTranscript
    }),
    onProgress: (stage) => stages.push(stage),
    ...overrides,
  }

  return { deps, calls, stages }
}

describe('runPrecisionJob', () => {
  it('runs plan → quote → pay → upload → submit → parts → save, in that order', async () => {
    const { deps, calls } = makeDeps()

    const result = await runPrecisionJob(deps, { mediaId: 'media-1', model: MODEL })

    expect(result).toBe(savedTranscript)
    expect(calls).toEqual(['plan', 'quote', 'pay', 'upload', 'submit', 'part-0', 'part-1', 'save'])
  })

  it('uploads only after the payment resolved, so unpaid audio never reaches the bucket', async () => {
    const { deps, calls } = makeDeps({
      pay: vi.fn(async () => {
        calls.push('pay')
        throw new Error('user rejected')
      }),
    })

    await expect(runPrecisionJob(deps, { mediaId: 'media-1', model: MODEL })).rejects.toThrow(
      'user rejected',
    )
    expect(calls).toEqual(['plan', 'quote', 'pay'])
    expect(vi.mocked(deps.upload)).not.toHaveBeenCalled()
    expect(vi.mocked(deps.submit)).not.toHaveBeenCalled()
  })

  it('sends the tx hash to submit and never pays a free run', async () => {
    const { deps } = makeDeps({
      quote: vi.fn(async () => ({ jobId: 'job-2', free: true, priceUsd: 0 })),
    })

    await runPrecisionJob(deps, { mediaId: 'media-1', model: MODEL })

    expect(vi.mocked(deps.pay)).not.toHaveBeenCalled()
    expect(vi.mocked(deps.submit).mock.calls[0]?.[0]).toMatchObject({
      jobId: 'job-2',
      txHash: null,
    })
  })

  it('passes the payment to submit for a paid run', async () => {
    const { deps } = makeDeps()

    await runPrecisionJob(deps, { mediaId: 'media-1', model: MODEL })

    expect(vi.mocked(deps.submit).mock.calls[0]?.[0]).toMatchObject({
      jobId: 'job-1',
      txHash: '0xfeed',
    })
  })

  it('saves one transcript with the overlap removed, under the model that produced it', async () => {
    const { deps } = makeDeps()
    const saved: MediaTranscript[] = []
    deps.save = vi.fn(async (merged, model) => {
      saved.push({ text: merged.text, model } as unknown as MediaTranscript)
      return savedTranscript
    })

    await runPrecisionJob(deps, { mediaId: 'media-1', model: MODEL })

    // The repeated "b" at the seam appears once, and offsets follow the source not the part.
    expect(vi.mocked(deps.save).mock.calls[0]?.[0].text).toBe('a b c')
    expect(vi.mocked(deps.save).mock.calls[0]?.[1]).toBe(MODEL)
    expect(saved[0]?.model).toBe(MODEL)
  })

  it('retries a part that throws once, and finishes', async () => {
    let attempts = 0
    const { deps, calls } = makeDeps({
      transcribePart: vi.fn(async ({ partIndex }: { partIndex: number }) => {
        if (partIndex === 1 && attempts === 0) {
          attempts += 1
          throw new Error('502')
        }
        return { segments: [{ speakerLabel: null, text: 'c', words: words(['c', 20, 21]) }] }
      }),
    })
    calls.length = 0

    await runPrecisionJob(deps, { mediaId: 'media-1', model: MODEL })

    expect(vi.mocked(deps.transcribePart)).toHaveBeenCalledTimes(3)
  })

  it('retries a part that returns no words once, and finishes', async () => {
    let empty = 0
    const { deps } = makeDeps({
      transcribePart: vi.fn(async ({ partIndex }: { partIndex: number }) => {
        if (partIndex === 0 && empty === 0) {
          empty += 1
          return { segments: [] }
        }
        return {
          segments: [{ speakerLabel: null, text: 'a', words: words(['a', 0, 1]) }],
        }
      }),
    })

    await runPrecisionJob(deps, { mediaId: 'media-1', model: MODEL })

    expect(vi.mocked(deps.transcribePart)).toHaveBeenCalledTimes(3)
  })

  it('gives up on a part that keeps throwing, naming its index', async () => {
    const { deps } = makeDeps({
      transcribePart: vi.fn(async ({ partIndex }: { partIndex: number }) => {
        if (partIndex === 1) throw new Error('502')
        return { segments: [{ speakerLabel: null, text: 'a', words: words(['a', 0, 1]) }] }
      }),
    })

    const run = runPrecisionJob(deps, { mediaId: 'media-1', model: MODEL })

    await expect(run).rejects.toBeInstanceOf(PrecisionPartError)
    await expect(run).rejects.toMatchObject({ partIndex: 1 })
    expect(vi.mocked(deps.save)).not.toHaveBeenCalled()
  })

  it('refuses to save a transcript with a persistently empty part', async () => {
    const { deps } = makeDeps({
      transcribePart: vi.fn(async ({ partIndex }: { partIndex: number }) => {
        if (partIndex === 1) return { segments: [] }
        return { segments: [{ speakerLabel: null, text: 'a', words: words(['a', 0, 1]) }] }
      }),
    })

    const run = runPrecisionJob(deps, { mediaId: 'media-1', model: MODEL })

    await expect(run).rejects.toBeInstanceOf(IncompleteTranscriptError)
    await expect(run).rejects.toMatchObject({ emptyPartIndexes: [1] })
    expect(vi.mocked(deps.save)).not.toHaveBeenCalled()
  })

  it('asks for parts in ascending index, so the merge always sees its predecessor', async () => {
    const order: number[] = []
    const { deps } = makeDeps({
      transcribePart: vi.fn(async ({ partIndex }: { partIndex: number }) => {
        order.push(partIndex)
        return {
          segments: [
            {
              speakerLabel: null,
              text: 'a',
              words: words(['a', partIndex * 10, partIndex * 10 + 1]),
            },
          ],
        }
      }),
    })

    await runPrecisionJob(deps, { mediaId: 'media-1', model: MODEL })

    expect(order).toEqual([0, 1])
  })

  it('reports the stage it is in, so the dialog can show something honest', async () => {
    const { deps, stages } = makeDeps()

    await runPrecisionJob(deps, { mediaId: 'media-1', model: MODEL })

    expect(stages).toEqual([
      'planning',
      'quoting',
      'paying',
      'uploading',
      'submitting',
      'transcribing',
      'transcribing',
      'saving',
    ])
  })
})
