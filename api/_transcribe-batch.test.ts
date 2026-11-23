import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The fixtures are real captured operations from this project's own bucket, so
 * they are the contract: `op_poll` is a rejected 59-minute file, `poll4` is a
 * healthy four-part job. Read by path rather than imported, because `api/` must
 * not carry `../src/` specifiers (see scripts/check-api-src-imports.mjs).
 */
const FIXTURES = resolve(process.cwd(), 'src/features/media-library/transcription/chirp/fixtures')

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as unknown
}

vi.mock('./_vertex-auth.js', () => ({
  getVertexProject: () => 'creative-ai-491118',
  getVertexAccessToken: async () => 'test-token',
}))

const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'
const JOB = 'job-1'
const OWN_URI = `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/${JOB}/part-0.flac`
const OPERATION = 'projects/1037240986506/locations/us/operations/v2-abc'

async function batch() {
  return import('./_transcribe-batch.js')
}

describe('pollTranscriptionOperation', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => Response.json({})) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  async function pollFixture(name: string) {
    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json(fixture(name)))
    const { pollTranscriptionOperation } = await batch()
    return pollTranscriptionOperation(OPERATION)
  }

  it('reads a finished multi-part job from the real capture', async () => {
    const summary = await pollFixture('poll4.json')

    expect(summary.status).toBe('completed')
    expect(summary.progressPercent).toBe(100)
    expect(summary.files).toHaveLength(4)
    expect(summary.totalBilledSeconds).toBe(4560)
    // Every file billed exactly 19 minutes, and the total is the sum of the parts.
    expect(summary.files.map((file) => file.billedSeconds)).toEqual([1140, 1140, 1140, 1140])
    expect(summary.files.every((file) => file.errorMessage === null)).toBe(true)
    expect(summary.files[0]?.outputUri).toMatch(
      /^gs:\/\/creative-pixels-transcribe-batch\/output\//,
    )
    // Results are keyed by *input* uri, which is how the reconciler maps them back.
    expect(summary.files.every((file) => file.inputUri.startsWith('gs://'))).toBe(true)
  })

  it('reads a rejected file as an error with no billed seconds', async () => {
    const summary = await pollFixture('op_poll.json')

    expect(summary.status).toBe('completed')
    expect(summary.files).toHaveLength(1)
    expect(summary.files[0]?.errorMessage).toContain('Only audio files up to 20 minutes')
    // A failed file has a uri and a cloudStorageResult but no metadata: absent, not zero.
    expect(summary.files[0]?.billedSeconds).toBeNull()
    // The rejected batch still reports 0s total — which is why the accumulator must
    // treat 0s-with-submitted-audio as a submit failure, not a free job.
    expect(summary.totalBilledSeconds).toBe(0)
  })

  it('reports progress while the operation is still running', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({ done: false, metadata: { progressPercent: 42 } }),
    )
    const { pollTranscriptionOperation } = await batch()
    const summary = await pollTranscriptionOperation(OPERATION)

    expect(summary.status).toBe('running')
    expect(summary.progressPercent).toBe(42)
    expect(summary.files).toEqual([])
  })

  it('treats a finished operation with no response as failed, not completed', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({ done: true, metadata: { progressPercent: 100 } }),
    )
    const { pollTranscriptionOperation } = await batch()
    const summary = await pollTranscriptionOperation(OPERATION)

    expect(summary.status).toBe('failed')
    expect(summary.errorMessage).toBe('operation finished without a response')
  })

  it('surfaces an operation-level error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({ done: true, error: { code: 7, message: 'PERMISSION_DENIED on bucket' } }),
    )
    const { pollTranscriptionOperation } = await batch()
    const summary = await pollTranscriptionOperation(OPERATION)

    expect(summary.status).toBe('failed')
    expect(summary.errorMessage).toBe('PERMISSION_DENIED on bucket')
  })

  it('clamps a nonsense progress value instead of trusting it', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({ done: false, metadata: { progressPercent: 400 } }),
    )
    const { pollTranscriptionOperation } = await batch()
    expect((await pollTranscriptionOperation(OPERATION)).progressPercent).toBe(100)

    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json({ done: false }))
    expect((await pollTranscriptionOperation(OPERATION)).progressPercent).toBe(0)
  })

  it('refuses to poll anything that is not an operations resource', async () => {
    const { pollTranscriptionOperation } = await batch()
    await expect(pollTranscriptionOperation('https://evil.test/steal')).rejects.toThrow(
      'invalid operation name',
    )
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled()
  })
})

describe('submitTranscriptionBatch', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ name: OPERATION }),
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function sentBody(): {
    recognizer: string
    config: Record<string, unknown>
    recognitionOutputConfig: { gcsOutputConfig: { uri: string } }
    files: Array<{ uri: string; config?: { languageCodes?: string[] } }>
  } {
    const call = vi.mocked(globalThis.fetch).mock.calls[0]
    return JSON.parse(String((call?.[1] as RequestInit).body))
  }

  it('POSTs to the regional batchRecognize endpoint with chirp_3 and no diarization', async () => {
    const { submitTranscriptionBatch } = await batch()
    const result = await submitTranscriptionBatch({ files: [{ uri: OWN_URI }] })

    expect(result.operationName).toBe(OPERATION)
    // Speech v2 is served from multi-region `us` for this project, not us-central1.
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toBe(
      'https://us-speech.googleapis.com/v2/projects/creative-ai-491118/locations/us/recognizers/_:batchRecognize',
    )
    expect((vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit).method).toBe('POST')

    const body = sentBody()
    expect(body.recognizer).toBe('projects/creative-ai-491118/locations/us/recognizers/_')
    expect(body.config.model).toBe('chirp_3')
    expect(body.config.languageCodes).toEqual(['en-US'])
    // Diarization silently truncates words on chirp_3, so it must not be requested.
    expect(JSON.stringify(body)).not.toContain('diarization')
    expect((body.config.features as { enableWordTimeOffsets: boolean }).enableWordTimeOffsets).toBe(
      true,
    )
    expect(body.recognitionOutputConfig.gcsOutputConfig.uri).toBe(
      'gs://creative-pixels-transcribe-batch/output/',
    )
    // A file with no language override carries no per-file config at all.
    expect(body.files[0]?.config).toBeUndefined()
  })

  it('passes a per-file language override through', async () => {
    const { submitTranscriptionBatch } = await batch()
    await submitTranscriptionBatch({
      files: [{ uri: OWN_URI, languageCode: 'ja-JP' }],
      languageCode: 'en-US',
    })

    expect(sentBody().files[0]?.config?.languageCodes).toEqual(['ja-JP'])
  })

  it('refuses an empty batch without calling Google', async () => {
    const { submitTranscriptionBatch } = await batch()
    await expect(submitTranscriptionBatch({ files: [] })).rejects.toThrow('at least one file')
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled()
  })

  it('fails loudly when Google returns no operation name', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json({}))
    const { submitTranscriptionBatch } = await batch()
    await expect(submitTranscriptionBatch({ files: [{ uri: OWN_URI }] })).rejects.toThrow(
      'no operation name',
    )
  })
})
