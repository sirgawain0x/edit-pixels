import { beforeEach, describe, expect, it, vi } from 'vitest'

const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'
const JOB = 'job-1'
const OWN_URI = `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/${JOB}/part-0.wav`

vi.mock('./_pixels-generate-route-auth.js', () => ({
  authenticateGenerativePost: vi.fn(),
}))

vi.mock('./_rate-limit.js', () => ({
  checkPixelsRateLimits: vi.fn(async () => null),
}))

vi.mock('./_transcription-jobs.js', () => ({
  readTranscriptionJob: vi.fn(),
}))

vi.mock('./_transcribe-gemini.js', () => ({
  transcribeFile: vi.fn(),
}))

import { checkPixelsRateLimits } from './_rate-limit.js'
import { transcribeFile } from './_transcribe-gemini.js'
import { authenticateGenerativePost } from './_pixels-generate-route-auth.js'
import { readTranscriptionJob } from './_transcription-jobs.js'
import { POST } from './transcribe-part.js'

/** A paid, per-part job: submitted, no Google operation attached. */
const paidJob = {
  accountId: ACCOUNT,
  status: 'running' as const,
  reconcileVerdict: null,
  quoteId: 'quote-1',
  minCrtvaiWei: '950000000000000000',
  estimatedUsdc6: 198_000,
  submittedSecondsCeil: 1200,
  operationName: null,
  glossary: null,
  txHash: '0xabc',
  freeRunMonth: null,
}

const geminiResult = {
  text: 'hello world',
  segments: [
    {
      speakerLabel: 'spk:0',
      text: 'hello world',
      words: [
        { word: 'hello', startSeconds: 0.1, endSeconds: 0.5 },
        { word: 'world', startSeconds: 0.6, endSeconds: 1 },
      ],
    },
  ],
  usage: { audioPromptTokens: 182, textPromptTokens: 8, outputTokens: 25 },
  modelVersion: 'gemini-3.5-transcribe',
  finishReason: 'STOP',
}

function post(body: Record<string, unknown>): Request {
  return new Request('https://pixels.test/api/transcribe-part', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.mocked(authenticateGenerativePost).mockReset()
  vi.mocked(authenticateGenerativePost).mockImplementation(async (request: Request) => ({
    ok: true,
    signer: ACCOUNT,
    payer: ACCOUNT,
    body: (await request.clone().json()) as Record<string, unknown>,
  }))

  vi.mocked(readTranscriptionJob).mockReset()
  vi.mocked(readTranscriptionJob).mockResolvedValue(paidJob)

  vi.mocked(checkPixelsRateLimits).mockReset()
  vi.mocked(checkPixelsRateLimits).mockResolvedValue(null)

  vi.mocked(transcribeFile).mockReset()
  vi.mocked(transcribeFile).mockResolvedValue(geminiResult)
})

describe('POST /api/transcribe-part', () => {
  it('rejects a malformed body', async () => {
    for (const body of [
      { uri: OWN_URI, partIndex: 0 },
      { jobId: JOB, partIndex: 0 },
      { jobId: JOB, uri: OWN_URI },
      { jobId: JOB, uri: OWN_URI, partIndex: 'zero' },
      { jobId: JOB, uri: OWN_URI, partIndex: 1.5 },
      { jobId: JOB, uri: OWN_URI, partIndex: -1 },
      { jobId: JOB, uri: OWN_URI, partIndex: 999 },
    ]) {
      const response = await POST(post(body))
      expect(response.status).toBe(400)
    }
    expect(vi.mocked(transcribeFile)).not.toHaveBeenCalled()
  })

  it('refuses an audio type the upload session would never have issued', async () => {
    const response = await POST(post({ jobId: JOB, uri: `${OWN_URI}.exe`, partIndex: 0 }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'unsupported_audio_type' })
    expect(vi.mocked(transcribeFile)).not.toHaveBeenCalled()
  })

  it('reads another account’s job as missing', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({
      ...paidJob,
      accountId: '0x0000000000000000000000000000000000000001',
    })

    const response = await POST(post({ jobId: JOB, uri: OWN_URI, partIndex: 0 }))
    expect(response.status).toBe(404)
  })

  it('refuses an unpaid job, which is what stops us spending on a quote nobody bought', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({ ...paidJob, status: 'quoted' })

    const response = await POST(post({ jobId: JOB, uri: OWN_URI, partIndex: 0 }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'job_not_payable' })
    expect(vi.mocked(transcribeFile)).not.toHaveBeenCalled()
  })

  it('refuses a batch job, which Google drives instead', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({
      ...paidJob,
      operationName: 'projects/1/locations/us/operations/existing',
      glossary: null,
    })

    const response = await POST(post({ jobId: JOB, uri: OWN_URI, partIndex: 0 }))

    expect(response.status).toBe(409)
    expect(vi.mocked(transcribeFile)).not.toHaveBeenCalled()
  })

  it('refuses a file outside this job’s prefix, before spending anything', async () => {
    const response = await POST(
      post({
        jobId: JOB,
        uri: `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/job-2/part-0.wav`,
        partIndex: 0,
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'file_not_owned_by_job' })
    expect(vi.mocked(transcribeFile)).not.toHaveBeenCalled()
  })

  it('refuses another bucket even when the prefix matches', async () => {
    const response = await POST(
      post({
        jobId: JOB,
        uri: `gs://someone-else/input/${ACCOUNT}/${JOB}/part-0.wav`,
        partIndex: 0,
      }),
    )

    expect(response.status).toBe(400)
    expect(vi.mocked(transcribeFile)).not.toHaveBeenCalled()
  })

  it('transcribes the part with timestamps and diarization, and returns relative offsets', async () => {
    const response = await POST(post({ jobId: JOB, uri: OWN_URI, partIndex: 3 }))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(vi.mocked(transcribeFile).mock.calls[0]?.[0]).toEqual({
      fileUri: OWN_URI,
      mimeType: 'audio/wav',
      options: { mode: 'VERBATIM', wordTimestamp: true, diarization: true },
    })
    expect(body).toMatchObject({
      jobId: JOB,
      partIndex: 3,
      text: 'hello world',
      finishReason: 'STOP',
      usage: { audioPromptTokens: 182 },
    })
    // Offsets stay relative: only the client knows where this part starts.
    expect((body.segments as Array<{ speakerLabel: string }>)[0]).toMatchObject({
      speakerLabel: 'spk:0',
    })
  })

  it('sends the quote’s glossary as custom vocabulary, split and de-duplicated', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({
      ...paidJob,
      glossary: 'Gawain, CRTVAI\nGawain,  \nmeToken',
    })

    await POST(post({ jobId: JOB, uri: OWN_URI, partIndex: 0 }))

    expect(vi.mocked(transcribeFile).mock.calls[0]?.[0].options).toMatchObject({
      customVocabulary: ['Gawain', 'CRTVAI', 'meToken'],
    })
  })

  it('omits the vocabulary when the quote carried none', async () => {
    await POST(post({ jobId: JOB, uri: OWN_URI, partIndex: 0 }))

    expect(vi.mocked(transcribeFile).mock.calls[0]?.[0].options).not.toHaveProperty(
      'customVocabulary',
    )
  })

  it('reports a per-part failure as retryable, not as a dead job', async () => {
    vi.mocked(transcribeFile).mockRejectedValue(new Error('Transcribe error 400: bad audio'))

    const response = await POST(post({ jobId: JOB, uri: OWN_URI, partIndex: 0 }))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'part_failed' })
  })

  it('stops when the caller is over their rate limit', async () => {
    vi.mocked(checkPixelsRateLimits).mockResolvedValue(
      Response.json({ error: 'rate_limited' }, { status: 429 }),
    )

    const response = await POST(post({ jobId: JOB, uri: OWN_URI, partIndex: 0 }))

    expect(response.status).toBe(429)
    expect(vi.mocked(transcribeFile)).not.toHaveBeenCalled()
  })
})
