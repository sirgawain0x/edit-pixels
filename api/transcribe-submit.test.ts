import { beforeEach, describe, expect, it, vi } from 'vitest'

const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'
const JOB = 'job-1'
const OWN_URI = `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/${JOB}/part-0.flac`
const MIN_WEI = '950000000000000000'

/**
 * Synchronous mock factories on purpose: an async factory with `importOriginal`
 * raced under CI's parallel load, so the first test saw the real module. The URI
 * guard therefore lives in its own module (`_transcribe-uris.ts`) and runs real.
 */
vi.mock('./_pixels-generate-route-auth.js', () => ({
  authenticateGenerativePost: vi.fn(),
  verifyGenerativeCrtvaiPayment: vi.fn(),
}))

vi.mock('./_transcribe-gcs.js', () => ({
  statParts: vi.fn(),
}))

vi.mock('./_transcription-jobs.js', () => ({
  readTranscriptionJob: vi.fn(),
  recordPartsSubmission: vi.fn(),
  refundFreeRun: vi.fn(),
}))

vi.mock('./flow-billing.js', () => ({
  releaseFlowPayment: vi.fn(),
}))

import { releaseFlowPayment } from './flow-billing.js'
import {
  authenticateGenerativePost,
  verifyGenerativeCrtvaiPayment,
} from './_pixels-generate-route-auth.js'
import { statParts } from './_transcribe-gcs.js'
import {
  readTranscriptionJob,
  recordPartsSubmission,
  refundFreeRun,
} from './_transcription-jobs.js'
import { POST } from './transcribe-submit.js'

const quotedJob = {
  accountId: ACCOUNT,
  status: 'quoted' as const,
  reconcileVerdict: null,
  quoteId: 'quote-1',
  minCrtvaiWei: MIN_WEI,
  estimatedUsdc6: 150_000,
  submittedSecondsCeil: 1200,
  operationName: null,
  glossary: null,
  txHash: null,
  freeRunMonth: null,
}

function post(body: Record<string, unknown>): Request {
  return new Request('https://pixels.test/api/transcribe-submit', {
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

  vi.mocked(verifyGenerativeCrtvaiPayment).mockReset()
  vi.mocked(verifyGenerativeCrtvaiPayment).mockResolvedValue({ ok: true, logIndex: 7 })

  vi.mocked(readTranscriptionJob).mockReset()
  vi.mocked(readTranscriptionJob).mockResolvedValue(quotedJob)
  vi.mocked(recordPartsSubmission).mockReset()
  vi.mocked(recordPartsSubmission).mockResolvedValue(true)

  vi.mocked(releaseFlowPayment).mockReset()
  vi.mocked(releaseFlowPayment).mockResolvedValue(undefined)

  vi.mocked(refundFreeRun).mockReset()
  vi.mocked(refundFreeRun).mockResolvedValue(true)

  vi.mocked(statParts).mockReset()
  vi.mocked(statParts).mockImplementation(async (uris: string[]) =>
    uris.map((uri) => ({ uri, exists: true, sizeBytes: 4096 })),
  )
})

describe('POST /api/transcribe-submit', () => {
  it('rejects a body without a job, a payment, or files', async () => {
    for (const body of [
      { files: [{ uri: OWN_URI }], paymentTxHash: '0xabc' },
      { jobId: JOB, files: [{ uri: OWN_URI }] },
      { jobId: JOB, paymentTxHash: '0xabc', files: [] },
      { jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: 123 }] },
    ]) {
      const response = await POST(post(body))
      expect(response.status).toBe(400)
    }
  })

  it('ignores a non-string language override instead of failing the submit', async () => {
    const response = await POST(
      post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI, languageCode: 5 }] }),
    )

    expect(response.status).toBe(200)
    expect(vi.mocked(recordPartsSubmission)).toHaveBeenCalled()
  })

  it('reads another account’s job as missing', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({
      ...quotedJob,
      accountId: '0x0000000000000000000000000000000000000001',
    })

    const response = await POST(
      post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }),
    )
    expect(response.status).toBe(404)
  })

  it('refuses files outside this job’s own prefix before any payment check', async () => {
    const response = await POST(
      post({
        jobId: JOB,
        paymentTxHash: '0xabc',
        files: [
          { uri: OWN_URI },
          { uri: `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/job-2/part-0.flac` },
        ],
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'file_not_owned_by_job' })
    expect(vi.mocked(verifyGenerativeCrtvaiPayment)).not.toHaveBeenCalled()
    expect(vi.mocked(recordPartsSubmission)).not.toHaveBeenCalled()
  })

  it('stops when the payment does not verify', async () => {
    vi.mocked(verifyGenerativeCrtvaiPayment).mockResolvedValue({
      ok: false,
      reason: 'tx not found',
    })

    const response = await POST(
      post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }),
    )

    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({
      error: 'payment_not_verified',
      reason: 'tx not found',
    })
    expect(vi.mocked(recordPartsSubmission)).not.toHaveBeenCalled()
  })

  it('verifies against the minimum pinned on the quote', async () => {
    await POST(post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }))

    expect(vi.mocked(verifyGenerativeCrtvaiPayment).mock.calls[0]?.[0]).toMatchObject({
      paymentTxHash: '0xabc',
      signer: ACCOUNT,
      payer: ACCOUNT,
      // The verifier compares wei, so the stored decimal string is converted back.
      quote: { minCrtvaiWei: 950_000_000_000_000_000n },
      purpose: 'transcribe',
    })
  })

  it('pins the payment on the record and reports how many parts the client may transcribe', async () => {
    const response = await POST(
      post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }),
    )

    // No Google call here any more: the model is unary and the client drives each part.
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ jobId: JOB, free: false, parts: 1 })
    expect(vi.mocked(recordPartsSubmission).mock.calls[0]?.[0]).toMatchObject({
      jobId: JOB,
      txHash: '0xabc',
      logIndex: 7,
    })
  })

  it('is idempotent: a running batch job returns its operation instead of being re-submitted', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({
      ...quotedJob,
      status: 'running',
      operationName: 'projects/1/locations/us/operations/existing',
      glossary: null,
      txHash: '0xabc',
    })

    const response = await POST(
      post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ alreadySubmitted: true })
    expect(vi.mocked(verifyGenerativeCrtvaiPayment)).not.toHaveBeenCalled()
    expect(vi.mocked(recordPartsSubmission)).not.toHaveBeenCalled()
  })

  it('refuses a job that is already finished', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({ ...quotedJob, status: 'completed' })

    const response = await POST(
      post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }),
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'job_not_submittable' })
  })

  it('refuses a job whose quote never pinned a usable minimum', async () => {
    for (const minCrtvaiWei of [null, 'not-a-number']) {
      vi.mocked(readTranscriptionJob).mockResolvedValue({ ...quotedJob, minCrtvaiWei })

      const response = await POST(
        post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }),
      )
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: 'quote_missing' })
    }
    expect(vi.mocked(recordPartsSubmission)).not.toHaveBeenCalled()
  })

  it('hands the payment back when the submission cannot be recorded', async () => {
    vi.mocked(recordPartsSubmission).mockRejectedValue(new Error('Firestore 500'))

    const response = await POST(
      post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }),
    )

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'submit_failed' })
    // The tx was consumed before the write, so a failed submit must release it.
    expect(vi.mocked(releaseFlowPayment)).toHaveBeenCalledWith('0xabc', 7)
  })

  it('releases the payment when the record write reports failure', async () => {
    vi.mocked(recordPartsSubmission).mockResolvedValue(false)

    const response = await POST(
      post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }),
    )

    // Unlike the batch path, a lost record leaves a paid job that cannot transcribe at all:
    // the part route refuses an unpaid job. So the money goes back rather than being kept.
    expect(response.status).toBe(502)
    expect(vi.mocked(releaseFlowPayment)).toHaveBeenCalledWith('0xabc', 7)
  })

  it('refuses to submit when a part never landed in the bucket', async () => {
    vi.mocked(statParts).mockImplementation(async (uris: string[]) =>
      uris.map((uri, index) => ({ uri, exists: index !== 1, sizeBytes: index === 1 ? 0 : 4096 })),
    )

    const response = await POST(
      post({
        jobId: JOB,
        paymentTxHash: '0xabc',
        files: [{ uri: OWN_URI }, { uri: `${OWN_URI}.part1` }],
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'files_missing' })
    // No tx is consumed and nothing is submitted with a hole in it.
    expect(vi.mocked(verifyGenerativeCrtvaiPayment)).not.toHaveBeenCalled()
    expect(vi.mocked(recordPartsSubmission)).not.toHaveBeenCalled()
  })

  it('refuses to submit when the bucket cannot be checked at all', async () => {
    vi.mocked(statParts).mockRejectedValue(new Error('GCS object stat failed (500)'))

    const response = await POST(
      post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }),
    )

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'storage_unavailable' })
    expect(vi.mocked(verifyGenerativeCrtvaiPayment)).not.toHaveBeenCalled()
  })

  it('submits a free run without a payment, since the allowance is the payment', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({
      ...quotedJob,
      minCrtvaiWei: null,
      estimatedUsdc6: 0,
      freeRunMonth: '2025-11',
    })

    const response = await POST(post({ jobId: JOB, files: [{ uri: OWN_URI }] }))
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.free).toBe(true)
    expect(vi.mocked(verifyGenerativeCrtvaiPayment)).not.toHaveBeenCalled()
    expect(vi.mocked(recordPartsSubmission).mock.calls[0]?.[0]).toMatchObject({
      jobId: JOB,
      txHash: null,
      logIndex: null,
    })
  })

  it('hands the free-run credit back when a free submission fails', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({
      ...quotedJob,
      minCrtvaiWei: null,
      estimatedUsdc6: 0,
      freeRunMonth: '2025-11',
    })
    vi.mocked(recordPartsSubmission).mockRejectedValue(new Error('Firestore 500'))

    const response = await POST(post({ jobId: JOB, files: [{ uri: OWN_URI }] }))

    expect(response.status).toBe(502)
    // A failed run must not eat one of the five: the credit goes back to the allowance.
    expect(vi.mocked(refundFreeRun)).toHaveBeenCalledWith(JOB)
    expect(vi.mocked(releaseFlowPayment)).not.toHaveBeenCalled()
  })

  it('asks for a payment when a priced job arrives without a tx hash', async () => {
    const response = await POST(post({ jobId: JOB, files: [{ uri: OWN_URI }] }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'payment_required' })
    expect(vi.mocked(recordPartsSubmission)).not.toHaveBeenCalled()
  })
})
