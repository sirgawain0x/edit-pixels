import { beforeEach, describe, expect, it, vi } from 'vitest'

const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'
const JOB = 'job-1'
const OWN_URI = `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/${JOB}/part-0.flac`
const MIN_WEI = '950000000000000000'

vi.mock('./_pixels-generate-route-auth.js', () => ({
  authenticateGenerativePost: vi.fn(),
  verifyGenerativeCrtvaiPayment: vi.fn(),
}))

// Keep the real URI guard: it is the security boundary this route exists to enforce.
vi.mock(import('./_transcribe-batch.js'), async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_transcribe-batch.js')>()),
  submitTranscriptionBatch: vi.fn(),
}))

vi.mock('./_transcription-jobs.js', () => ({
  readTranscriptionJob: vi.fn(),
  recordBatchSubmission: vi.fn(async () => true),
}))

vi.mock('./flow-billing.js', () => ({
  releaseFlowPayment: vi.fn(async () => undefined),
}))

async function route() {
  return import('./transcribe-submit.js')
}

async function mocks() {
  const [auth, batchModule, jobs, billing] = await Promise.all([
    import('./_pixels-generate-route-auth.js'),
    import('./_transcribe-batch.js'),
    import('./_transcription-jobs.js'),
    import('./flow-billing.js'),
  ])
  return { auth, batchModule, jobs, billing }
}

function post(body: Record<string, unknown>): Request {
  return new Request('https://pixels.test/api/transcribe-submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

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
}

beforeEach(async () => {
  const { auth, batchModule, jobs, billing } = await mocks()

  vi.mocked(auth.authenticateGenerativePost).mockResolvedValue({
    ok: true,
    signer: ACCOUNT,
    payer: ACCOUNT,
    body: {},
  })
  vi.mocked(auth.verifyGenerativeCrtvaiPayment).mockReset()
  vi.mocked(auth.verifyGenerativeCrtvaiPayment).mockResolvedValue({ ok: true, logIndex: 7 })

  vi.mocked(batchModule.submitTranscriptionBatch).mockReset()
  vi.mocked(batchModule.submitTranscriptionBatch).mockResolvedValue({
    operationName: 'projects/1037240986506/locations/us/operations/v2-abc',
  })

  vi.mocked(jobs.readTranscriptionJob).mockReset()
  vi.mocked(jobs.readTranscriptionJob).mockResolvedValue(quotedJob)
  vi.mocked(jobs.recordBatchSubmission).mockReset()
  vi.mocked(jobs.recordBatchSubmission).mockResolvedValue(true)

  vi.mocked(billing.releaseFlowPayment).mockReset()
  vi.mocked(billing.releaseFlowPayment).mockResolvedValue(undefined)
})

async function send(body: Record<string, unknown>) {
  const { POST } = await route()
  // The real helper parses the JSON body and hands it back, so feed it through here.
  const { auth } = await mocks()
  vi.mocked(auth.authenticateGenerativePost).mockImplementationOnce(async (request: Request) => ({
    ok: true,
    signer: ACCOUNT,
    payer: ACCOUNT,
    body: (await request.clone().json()) as Record<string, unknown>,
  }))
  return POST(post(body))
}

describe('POST /api/transcribe-submit', () => {
  it('rejects a body without a job, a payment, or files', async () => {
    const { POST } = await route()
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

  it('reads another account’s job as missing', async () => {
    const { jobs } = await mocks()
    vi.mocked(jobs.readTranscriptionJob).mockResolvedValue({
      ...quotedJob,
      accountId: '0x0000000000000000000000000000000000000001',
    })

    const response = await send({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] })
    expect(response.status).toBe(404)
  })

  it('refuses files outside this job’s own prefix before any payment check', async () => {
    const { auth, batchModule } = await mocks()
    const response = await send({
      jobId: JOB,
      paymentTxHash: '0xabc',
      files: [
        { uri: OWN_URI },
        { uri: `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/job-2/part-0.flac` },
      ],
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'file_not_owned_by_job' })
    expect(vi.mocked(auth.verifyGenerativeCrtvaiPayment)).not.toHaveBeenCalled()
    expect(vi.mocked(batchModule.submitTranscriptionBatch)).not.toHaveBeenCalled()
  })

  it('stops when the payment does not verify', async () => {
    const { auth, batchModule } = await mocks()
    vi.mocked(auth.verifyGenerativeCrtvaiPayment).mockResolvedValue({
      ok: false,
      reason: 'tx not found',
    })

    const response = await send({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] })

    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({
      error: 'payment_not_verified',
      reason: 'tx not found',
    })
    expect(vi.mocked(batchModule.submitTranscriptionBatch)).not.toHaveBeenCalled()
  })

  it('verifies against the minimum pinned on the quote', async () => {
    const { auth } = await mocks()
    await send({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] })

    expect(vi.mocked(auth.verifyGenerativeCrtvaiPayment).mock.calls[0]?.[0]).toMatchObject({
      paymentTxHash: '0xabc',
      signer: ACCOUNT,
      payer: ACCOUNT,
      // The verifier compares wei, so the stored decimal string is converted back.
      quote: { minCrtvaiWei: 950_000_000_000_000_000n },
      purpose: 'transcribe',
    })
  })

  it('submits, then pins the operation and the payment on the record', async () => {
    const { jobs, batchModule } = await mocks()
    const response = await send({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jobId: JOB,
      operationName: 'projects/1037240986506/locations/us/operations/v2-abc',
    })
    expect(vi.mocked(batchModule.submitTranscriptionBatch)).toHaveBeenCalledWith({
      files: [{ uri: OWN_URI }],
      languageCode: undefined,
    })
    expect(vi.mocked(jobs.recordBatchSubmission).mock.calls[0]?.[0]).toMatchObject({
      jobId: JOB,
      operationName: 'projects/1037240986506/locations/us/operations/v2-abc',
      txHash: '0xabc',
      logIndex: 7,
    })
  })

  it('is idempotent: a running job returns its operation instead of billing Google twice', async () => {
    const { jobs, auth, batchModule } = await mocks()
    vi.mocked(jobs.readTranscriptionJob).mockResolvedValue({
      ...quotedJob,
      status: 'running',
      operationName: 'projects/1/locations/us/operations/existing',
      txHash: '0xabc',
    })

    const response = await send({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ alreadySubmitted: true })
    expect(vi.mocked(auth.verifyGenerativeCrtvaiPayment)).not.toHaveBeenCalled()
    expect(vi.mocked(batchModule.submitTranscriptionBatch)).not.toHaveBeenCalled()
  })

  it('refuses a job that is already finished', async () => {
    const { jobs } = await mocks()
    vi.mocked(jobs.readTranscriptionJob).mockResolvedValue({ ...quotedJob, status: 'completed' })

    const response = await send({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'job_not_submittable' })
  })

  it('refuses a job whose quote never pinned a minimum', async () => {
    const { jobs } = await mocks()
    vi.mocked(jobs.readTranscriptionJob).mockResolvedValue({ ...quotedJob, minCrtvaiWei: null })

    const response = await send({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'quote_missing' })
  })

  it('hands the payment back when Google rejects the batch', async () => {
    const { batchModule, billing, jobs } = await mocks()
    vi.mocked(batchModule.submitTranscriptionBatch).mockRejectedValue(new Error('Speech error 400'))

    const response = await send({ jobId: JOB, paymentTxHash: '0xabc', files: [{ uri: OWN_URI }] })

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'submit_failed' })
    // The tx was consumed before the call, so a failed submit must release it.
    expect(vi.mocked(billing.releaseFlowPayment)).toHaveBeenCalledWith('0xabc', 7)
    expect(vi.mocked(jobs.recordBatchSubmission)).not.toHaveBeenCalled()
  })
})
