import { beforeEach, describe, expect, it, vi } from 'vitest'

const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'
const JOB = 'job-1'

vi.mock('./_pixels-generate-route-auth.js', () => ({
  authenticateGenerativePost: vi.fn(),
}))

vi.mock('./_rate-limit.js', () => ({
  checkPixelsRateLimits: vi.fn(async () => null),
}))

vi.mock('./_transcription-jobs.js', () => ({
  readTranscriptionJob: vi.fn(),
}))

// Synchronous factory: the predicates this route enforces live in _transcribe-uris,
// which stays real, so only the GCS call is mocked.
vi.mock('./_transcribe-gcs.js', () => ({
  createUploadSession: vi.fn(),
}))

import { createUploadSession } from './_transcribe-gcs.js'
import { authenticateGenerativePost } from './_pixels-generate-route-auth.js'
import { readTranscriptionJob } from './_transcription-jobs.js'
import { POST } from './transcribe-upload-session.js'

const quotedJob = {
  accountId: ACCOUNT,
  status: 'quoted' as const,
  reconcileVerdict: null,
  quoteId: 'quote-1',
  minCrtvaiWei: '950000000000000000',
  estimatedUsdc6: 150_000,
  submittedSecondsCeil: 1200,
  operationName: null,
  txHash: null,
  freeRunMonth: null,
}

function post(body: Record<string, unknown>): Request {
  return new Request('https://pixels.test/api/transcribe-upload-session', {
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
  vi.mocked(readTranscriptionJob).mockResolvedValue(quotedJob)

  vi.mocked(createUploadSession).mockReset()
  vi.mocked(createUploadSession).mockResolvedValue({
    sessionUri: 'https://storage.googleapis.com/upload/session/abc',
  })
})

describe('POST /api/transcribe-upload-session', () => {
  it('returns one session per part, scoped to the caller’s own job prefix', async () => {
    const response = await POST(
      post({
        jobId: JOB,
        files: [
          { name: 'part-0.webm', contentType: 'audio/webm' },
          { name: 'part-1.webm', contentType: 'audio/webm' },
        ],
      }),
    )
    const body = (await response.json()) as {
      jobId: string
      files: Array<{ name: string; uri: string; sessionUri: string }>
    }

    expect(response.status).toBe(200)
    expect(body.jobId).toBe(JOB)
    expect(body.files.map((file) => file.uri)).toEqual([
      `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/${JOB}/part-0.webm`,
      `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/${JOB}/part-1.webm`,
    ])
    expect(
      body.files.every((file) => file.sessionUri.startsWith('https://storage.googleapis')),
    ).toBe(true)
    // The client's leaf name is appended to *our* prefix, never used as a path.
    expect(vi.mocked(createUploadSession).mock.calls[0]?.[0]).toMatchObject({
      objectName: `input/${ACCOUNT}/${JOB}/part-0.webm`,
      contentType: 'audio/webm',
      metadata: { jobId: JOB, accountId: ACCOUNT },
    })
  })

  it('normalises an uppercase signer into the prefix', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({
      ...quotedJob,
      accountId: ACCOUNT, // stored lowercase by the quote route
    })
    vi.mocked(authenticateGenerativePost).mockImplementationOnce(async () => ({
      ok: true,
      signer: ACCOUNT.toUpperCase() as `0x${string}`,
      payer: ACCOUNT,
      body: { jobId: JOB, files: [{ name: 'part-0.webm', contentType: 'audio/webm' }] },
    }))

    const response = await POST(post({ jobId: JOB }))
    expect(response.status).toBe(200)
    expect(vi.mocked(createUploadSession).mock.calls[0]?.[0].objectName).toBe(
      `input/${ACCOUNT}/${JOB}/part-0.webm`,
    )
  })

  it.each([
    ['no jobId', { files: [{ name: 'part-0.webm', contentType: 'audio/webm' }] }],
    ['no files', { jobId: JOB, files: [] }],
    ['a traversal name', { jobId: JOB, files: [{ name: '../x.webm', contentType: 'audio/webm' }] }],
    [
      'a slash in the name',
      { jobId: JOB, files: [{ name: 'a/b.webm', contentType: 'audio/webm' }] },
    ],
    [
      'an unlisted content type',
      { jobId: JOB, files: [{ name: 'part-0.mp4', contentType: 'video/mp4' }] },
    ],
    [
      'too many parts',
      {
        jobId: JOB,
        files: Array.from({ length: 33 }, (_, index) => ({
          name: `part-${index}.webm`,
          contentType: 'audio/webm',
        })),
      },
    ],
  ])('rejects %s', async (_label, body) => {
    const response = await POST(post(body as Record<string, unknown>))
    expect(response.status).toBe(400)
    expect(vi.mocked(createUploadSession)).not.toHaveBeenCalled()
  })

  it('reads another account’s job as missing', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({
      ...quotedJob,
      accountId: '0x0000000000000000000000000000000000000001',
    })

    const response = await POST(
      post({ jobId: JOB, files: [{ name: 'part-0.webm', contentType: 'audio/webm' }] }),
    )
    expect(response.status).toBe(404)
    expect(vi.mocked(createUploadSession)).not.toHaveBeenCalled()
  })

  it('refuses to issue sessions for a job that is no longer quoting', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({ ...quotedJob, status: 'running' })

    const response = await POST(
      post({ jobId: JOB, files: [{ name: 'part-0.webm', contentType: 'audio/webm' }] }),
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'job_not_uploadable' })
    expect(vi.mocked(createUploadSession)).not.toHaveBeenCalled()
  })

  it('reports a GCS failure as 502 instead of handing out partial sessions', async () => {
    vi.mocked(createUploadSession).mockRejectedValue(new Error('GCS upload session failed (403)'))

    const response = await POST(
      post({ jobId: JOB, files: [{ name: 'part-0.webm', contentType: 'audio/webm' }] }),
    )
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'upload_session_failed' })
  })

  it('passes an auth failure straight through', async () => {
    vi.mocked(authenticateGenerativePost).mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'unauthorized' }, { status: 401 }),
    })

    const response = await POST(
      post({ jobId: JOB, files: [{ name: 'part-0.webm', contentType: 'audio/webm' }] }),
    )
    expect(response.status).toBe(401)
    expect(vi.mocked(readTranscriptionJob)).not.toHaveBeenCalled()
  })
})
