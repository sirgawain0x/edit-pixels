import { describe, expect, it, vi, beforeEach } from 'vitest'

const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'
const OPERATION = 'projects/1037240986506/locations/us/operations/v2-abc'

vi.mock('./_pixels-generate-route-auth.js', () => ({
  authenticateGenerativeGet: vi.fn(async () => ({ ok: true, signer: ACCOUNT })),
}))

vi.mock('./_transcription-jobs.js', () => ({
  readTranscriptionJob: vi.fn(async () => null),
}))

vi.mock('./_transcribe-batch.js', () => ({
  pollTranscriptionOperation: vi.fn(async () => ({
    status: 'running',
    progressPercent: 0,
    files: [],
    totalBilledSeconds: null,
    errorMessage: null,
  })),
}))

async function route() {
  return import('./transcribe-job.js')
}

async function auth() {
  return import('./_pixels-generate-route-auth.js')
}

async function store() {
  return import('./_transcription-jobs.js')
}

async function batch() {
  return import('./_transcribe-batch.js')
}

/** A finished stored job: nothing left to poll. */
const FINISHED_JOB = {
  accountId: ACCOUNT,
  status: 'completed' as const,
  reconcileVerdict: 'exact' as const,
  quoteId: 'quote-1',
  minCrtvaiWei: '950000000000000000',
  estimatedUsdc6: 150_000,
  submittedSecondsCeil: 1200,
  operationName: OPERATION,
  txHash: '0xfeed',
}

const RUNNING_JOB = { ...FINISHED_JOB, status: 'running' as const, reconcileVerdict: null }

function poll(jobId?: string): Request {
  const url = jobId
    ? `https://pixels.test/api/transcribe-job?jobId=${encodeURIComponent(jobId)}`
    : 'https://pixels.test/api/transcribe-job'
  return new Request(url)
}

describe('GET /api/transcribe-job', () => {
  beforeEach(async () => {
    vi.mocked((await auth()).authenticateGenerativeGet).mockResolvedValue({
      ok: true,
      signer: ACCOUNT,
    })
    vi.mocked((await store()).readTranscriptionJob).mockReset()
    vi.mocked((await store()).readTranscriptionJob).mockResolvedValue(null)
    vi.mocked((await batch()).pollTranscriptionOperation).mockReset()
    vi.mocked((await batch()).pollTranscriptionOperation).mockResolvedValue({
      status: 'running',
      progressPercent: 0,
      files: [],
      totalBilledSeconds: null,
      errorMessage: null,
    })
  })

  it('rejects a poll with no jobId', async () => {
    const { GET } = await route()
    const response = await GET(poll())
    expect(response.status).toBe(400)
    // No ledger read happens for a malformed poll.
    expect(vi.mocked((await store()).readTranscriptionJob)).not.toHaveBeenCalled()
  })

  it('passes an auth failure straight through', async () => {
    vi.mocked((await auth()).authenticateGenerativeGet).mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'unauthorized' }, { status: 401 }),
    })

    const { GET } = await route()
    const response = await GET(poll('job-1'))
    expect(response.status).toBe(401)
    expect(vi.mocked((await store()).readTranscriptionJob)).not.toHaveBeenCalled()
  })

  it('returns the stored status and verdict for the owning account', async () => {
    vi.mocked((await store()).readTranscriptionJob).mockResolvedValue(FINISHED_JOB)

    const { GET } = await route()
    const response = await GET(poll('job-1'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jobId: 'job-1',
      status: 'completed',
      reconcileVerdict: 'exact',
    })
    expect(vi.mocked((await store()).readTranscriptionJob)).toHaveBeenCalledWith('job-1')
    // A finished job is never polled upstream again.
    expect(vi.mocked((await batch()).pollTranscriptionOperation)).not.toHaveBeenCalled()
  })

  it("reads another account's job as missing, so ids cannot be probed", async () => {
    vi.mocked((await store()).readTranscriptionJob).mockResolvedValue({
      ...FINISHED_JOB,
      accountId: '0x0000000000000000000000000000000000000001',
    })

    const { GET } = await route()
    const response = await GET(poll('job-1'))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'job not found' })
  })

  it('returns 404 for an unknown job', async () => {
    const { GET } = await route()
    const response = await GET(poll('job-missing'))
    expect(response.status).toBe(404)
  })

  it('projects progress from the Google operation while the job is running', async () => {
    vi.mocked((await store()).readTranscriptionJob).mockResolvedValue(RUNNING_JOB)
    vi.mocked((await batch()).pollTranscriptionOperation).mockResolvedValue({
      status: 'running',
      progressPercent: 42,
      files: [],
      totalBilledSeconds: null,
      errorMessage: null,
    })

    const { GET } = await route()
    const response = await GET(poll('job-1'))

    expect(await response.json()).toEqual({
      jobId: 'job-1',
      status: 'running',
      reconcileVerdict: null,
      progressPercent: 42,
    })
    expect(vi.mocked((await batch()).pollTranscriptionOperation)).toHaveBeenCalledWith(OPERATION)
  })

  it('reports a finished operation as completed with its per-file results', async () => {
    vi.mocked((await store()).readTranscriptionJob).mockResolvedValue(RUNNING_JOB)
    vi.mocked((await batch()).pollTranscriptionOperation).mockResolvedValue({
      status: 'completed',
      progressPercent: 100,
      files: [
        {
          inputUri: 'gs://creative-pixels-transcribe-batch/input/a.flac',
          outputUri: 'gs://creative-pixels-transcribe-batch/output/a.json',
          billedSeconds: 1140,
          errorMessage: null,
        },
      ],
      totalBilledSeconds: 1140,
      errorMessage: null,
    })

    const { GET } = await route()
    const response = await GET(poll('job-1'))
    const body = (await response.json()) as Record<string, unknown>

    // The stored row still says running; the poll projects the truth without writing.
    expect(body).toMatchObject({
      status: 'completed',
      progressPercent: 100,
      totalBilledSeconds: 1140,
    })
    expect(body.files).toHaveLength(1)
  })

  it('surfaces an operation failure without claiming the job finished cleanly', async () => {
    vi.mocked((await store()).readTranscriptionJob).mockResolvedValue(RUNNING_JOB)
    vi.mocked((await batch()).pollTranscriptionOperation).mockResolvedValue({
      status: 'failed',
      progressPercent: 100,
      files: [],
      totalBilledSeconds: null,
      errorMessage: 'PERMISSION_DENIED on bucket',
    })

    const { GET } = await route()
    const response = await GET(poll('job-1'))
    const body = (await response.json()) as Record<string, unknown>

    expect(body).toMatchObject({ status: 'failed', errorMessage: 'PERMISSION_DENIED on bucket' })
  })

  it('does not turn a poll failure into a job failure', async () => {
    vi.mocked((await store()).readTranscriptionJob).mockResolvedValue(RUNNING_JOB)
    vi.mocked((await batch()).pollTranscriptionOperation).mockRejectedValue(new Error('timeout'))

    const { GET } = await route()
    const response = await GET(poll('job-1'))
    const body = (await response.json()) as Record<string, unknown>

    expect(body).toMatchObject({ status: 'running', errorMessage: 'operation poll failed' })
  })
})
