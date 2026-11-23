import { describe, expect, it, vi } from 'vitest'
import type { CloudPart } from '../lib/plan-cloud-parts'
import {
  PART_PATH,
  QUOTE_PATH,
  SUBMIT_PATH,
  requestPrecisionQuote,
  requestTranscriptionPart,
  submitPrecisionJob,
  uploadPrecisionParts,
} from './precision-transcription-client'

function part(index: number, startSec: number, endSec: number, overlapSec: number): CloudPart {
  return {
    index,
    name: `part-${index}.wav`,
    contentType: 'audio/wav',
    blob: new Blob([new Uint8Array([1, 2, 3])]),
    startSec,
    endSec,
    overlapSec,
    forcedCut: false,
    sizeBytes: 3,
  }
}

const PARTS = [part(0, 0, 20, 1), part(1, 19, 30, 0)]

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

describe('requestPrecisionQuote', () => {
  it('sends the plan the server prices, with each part’s spoken span', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        jobId: 'job-1',
        free: false,
        quote: {
          quoteId: 'q-1',
          estimatedUsdc6: 297_000,
          minCrtvaiWei: '2970000000000000',
          expiresAtMs: 1,
        },
      }),
    ) as unknown as typeof fetch

    const quote = await requestPrecisionQuote({
      mediaId: 'media-1',
      model: 'gemini-3.5-transcribe',
      glossary: 'Gawain, CRTVAI',
      sourceDurationSec: 30,
      parts: PARTS,
      fetchImpl,
    })

    const [path, init] = vi.mocked(fetchImpl).mock.calls[0] ?? []
    expect(path).toBe(QUOTE_PATH)
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body).toMatchObject({
      mediaId: 'media-1',
      model: 'gemini-3.5-transcribe',
      glossary: 'Gawain, CRTVAI',
      sourceDurationSec: 30,
    })
    expect(body.plan).toEqual([
      { startSec: 0, endSec: 20, overlapSec: 1, forcedCut: false, vadSpeechSeconds: 20 },
      { startSec: 19, endSec: 30, overlapSec: 0, forcedCut: false, vadSpeechSeconds: 11 },
    ])

    // Micro-USDC becomes dollars, and the wei floor passes through untouched.
    expect(quote).toEqual({
      jobId: 'job-1',
      free: false,
      priceUsd: 0.297,
      minCrtvaiWei: '2970000000000000',
    })
  })

  it('treats a free run as a zero floor rather than a missing one', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jobId: 'job-2', free: true }),
    ) as unknown as typeof fetch

    const quote = await requestPrecisionQuote({
      mediaId: 'media-1',
      model: 'gemini-3.5-transcribe',
      sourceDurationSec: 30,
      parts: PARTS,
      fetchImpl,
    })

    expect(quote).toMatchObject({ free: true, priceUsd: 0, minCrtvaiWei: '0' })
  })

  it('omits the glossary when there is nothing to bias towards', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        jobId: 'job-1',
        free: false,
        quote: { estimatedUsdc6: 1, minCrtvaiWei: '1' },
      }),
    ) as unknown as typeof fetch

    await requestPrecisionQuote({
      mediaId: 'media-1',
      model: 'gemini-3.5-transcribe',
      sourceDurationSec: 30,
      parts: PARTS,
      fetchImpl,
    })

    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1] as RequestInit | undefined
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body).not.toHaveProperty('glossary')
  })

  it('surfaces the server’s own refusal instead of a bare status', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'source_too_long', reason: 'exceeds 480 minutes' }, 400),
    ) as unknown as typeof fetch

    await expect(
      requestPrecisionQuote({
        mediaId: 'media-1',
        model: 'gemini-3.5-transcribe',
        sourceDurationSec: 99_999,
        parts: PARTS,
        fetchImpl,
      }),
    ).rejects.toThrow('source_too_long: exceeds 480 minutes')
  })
})

describe('submitPrecisionJob', () => {
  it('sends the payment hash and every part URI', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jobId: 'job-1', free: false }),
    ) as unknown as typeof fetch

    await submitPrecisionJob({
      jobId: 'job-1',
      txHash: '0xfeed',
      files: [
        { index: 0, uri: 'gs://b/input/a/job-1/part-0.wav' },
        { index: 1, uri: 'gs://b/input/a/job-1/part-1.wav' },
      ],
      fetchImpl,
    })

    const [path, init] = vi.mocked(fetchImpl).mock.calls[0] ?? []
    expect(path).toBe(SUBMIT_PATH)
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      jobId: 'job-1',
      paymentTxHash: '0xfeed',
      files: [
        { uri: 'gs://b/input/a/job-1/part-0.wav' },
        { uri: 'gs://b/input/a/job-1/part-1.wav' },
      ],
    })
  })

  it('omits the hash for a free run, which pays with its allowance', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jobId: 'job-1', free: true }),
    ) as unknown as typeof fetch

    await submitPrecisionJob({
      jobId: 'job-1',
      txHash: null,
      files: [{ index: 0, uri: 'gs://b/input/a/job-1/part-0.wav' }],
      fetchImpl,
    })

    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).not.toHaveProperty('paymentTxHash')
  })
})

describe('requestTranscriptionPart', () => {
  it('returns the segments and tolerates a part with none', async () => {
    const segments = [
      {
        speakerLabel: 'spk:0',
        text: 'hi',
        words: [{ word: 'hi', startSeconds: 0, endSeconds: 1 }],
      },
    ]
    const withWords = vi.fn(async () =>
      jsonResponse({ jobId: 'j', partIndex: 0, segments }),
    ) as unknown as typeof fetch
    const without = vi.fn(async () =>
      jsonResponse({ jobId: 'j', partIndex: 1 }),
    ) as unknown as typeof fetch

    await expect(
      requestTranscriptionPart({ jobId: 'j', partIndex: 0, uri: 'gs://u', fetchImpl: withWords }),
    ).resolves.toEqual({ segments })
    await expect(
      requestTranscriptionPart({ jobId: 'j', partIndex: 1, uri: 'gs://u', fetchImpl: without }),
    ).resolves.toEqual({ segments: [] })

    expect(vi.mocked(withWords).mock.calls[0]?.[0]).toBe(PART_PATH)
  })

  it('reports a part failure so the orchestrator can retry it', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'part_failed' }, 502),
    ) as unknown as typeof fetch

    await expect(
      requestTranscriptionPart({ jobId: 'j', partIndex: 0, uri: 'gs://u', fetchImpl }),
    ).rejects.toThrow('part_failed')
  })
})

describe('uploadPrecisionParts', () => {
  it('numbers the landed files so each one can be paired with its span', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/transcribe-upload-session') {
        return jsonResponse({
          jobId: 'job-1',
          files: PARTS.map((entry, index) => ({
            name: entry.name,
            uri: `gs://b/input/a/job-1/${entry.name}`,
            sessionUri: `https://storage.test/session-${index}`,
          })),
        })
      }
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const landed = await uploadPrecisionParts({ jobId: 'job-1', parts: PARTS, fetchImpl })

    expect(landed).toEqual([
      { index: 0, uri: 'gs://b/input/a/job-1/part-0.wav' },
      { index: 1, uri: 'gs://b/input/a/job-1/part-1.wav' },
    ])
  })
})
