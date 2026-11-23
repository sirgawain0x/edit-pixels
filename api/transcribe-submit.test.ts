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

vi.mock('./_transcribe-batch.js', () => ({
  submitTranscriptionBatch: vi.fn(),
}))

vi.mock('./_transcription-jobs.js', () => ({
  readTranscriptionJob: vi.fn(),
  recordBatchSubmission: vi.fn(),
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
import { submitTranscriptionBatch } from './_transcribe-batch.js'
import {
  readTranscriptionJob,
  recordBatchSubmission,
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

  vi.mocked(submitTranscriptionBatch).mockReset()
  vi.mocked(submitTranscriptionBatch).mockResolvedValue({
    operationName: 'projects/1037240986506/locations/us/operations/v2-abc',
  })

  vi.mocked(readTranscriptionJob).mockReset()
  vi.mocked(readTranscriptionJob).mockResolvedValue(quotedJob)
  vi.mocked(recordBatchSubmission).mockReset()
  vi.mocked(recordBatchSubmission).mockResolvedValue(true)

  vi.mocked(releaseFlowPayment).mockReset()
  vi.mocked(releaseFlowPayment).mockResolvedValue(undefined)

  vi.mocked(refundFreeRun).mockReset()
  vi.mocked(refundFreeRun).mockResolvedValue(true)
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
    expect(vi.mocked(submitTranscriptionBatch)).toHaveBeenCalledWith({
      files: [{ uri: OWN_URI }],
      languageCode: undefined,
    })
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
    expect(vi.mocked(submitTranscriptionBatch)).not.toHaveBeenCalled()
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
    expect(vi.mocked(submitTranscriptionBatch)).not.toHaveBeenCalled()
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

  it('submits, then pins the operation and the payment on the record', async () => {
    const response = await POST(
      post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jobId: JOB,
      operationName: 'projects/1037240986506/locations/us/operations/v2-abc',
      free: false,
    })
    expect(vi.mocked(submitTranscriptionBatch)).toHaveBeenCalledWith({
      files: [{ uri: OWN_URI }],
      languageCode: undefined,
    })
    expect(vi.mocked(recordBatchSubmission).mock.calls[0]?.[0]).toMatchObject({
      jobId: JOB,
      operationName: 'projects/1037240986506/locations/us/operations/v2-abc',
      txHash: '0xabc',
      logIndex: 7,
    })
  })

  it('is idempotent: a running job returns its operation instead of billing Google twice', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({
      ...quotedJob,
      status: 'running',
      operationName: 'projects/1/locations/us/operations/existing',
      txHash: '0xabc',
    })

    const response = await POST(
      post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ alreadySubmitted: true })
    expect(vi.mocked(verifyGenerativeCrtvaiPayment)).not.toHaveBeenCalled()
    expect(vi.mocked(submitTranscriptionBatch)).not.toHaveBeenCalled()
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
    expect(vi.mocked(submitTranscriptionBatch)).not.toHaveBeenCalled()
  })

  it('hands the payment back when Google rejects the batch', async () => {
    vi.mocked(submitTranscriptionBatch).mockRejectedValue(new Error('Speech error 400'))

    const response = await POST(
      post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }),
    )

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'submit_failed' })
    // The tx was consumed before the call, so a failed submit must release it.
    expect(vi.mocked(releaseFlowPayment)).toHaveBeenCalledWith('0xabc', 7)
    expect(vi.mocked(recordBatchSubmission)).not.toHaveBeenCalled()
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
    expect(vi.mocked(recordBatchSubmission).mock.calls[0]?.[0]).toMatchObject({
      jobId: JOB,
      txHash: null,
      logIndex: null,
    })
  })

  it('hands the free-run credit back when Google refuses a free batch', async () => {
    vi.mocked(readTranscriptionJob).mockResolvedValue({
      ...quotedJob,
      minCrtvaiWei: null,
      estimatedUsdc6: 0,
      freeRunMonth: '2025-11',
    })
    vi.mocked(submitTranscriptionBatch).mockRejectedValue(new Error('Speech error 400'))

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
    expect(vi.mocked(submitTranscriptionBatch)).not.toHaveBeenCalled()
  })

  it('still reports the batch as running when the record write fails', async () => {
    vi.mocked(recordBatchSubmission).mockResolvedValue(false)

    const response = await POST(
      post({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] }),
    )

    // The operation name is the handle; losing the record must not hide the submission.
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      operationName: 'projects/1037240986506/locations/us/operations/v2-abc',
    })
  })
})
