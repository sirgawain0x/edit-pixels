import { describe, expect, it, vi, beforeEach } from 'vitest'

const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'

vi.mock('./_pixels-generate-route-auth.js', () => ({
  authenticateGenerativeGet: vi.fn(async () => ({ ok: true, signer: ACCOUNT })),
}))

vi.mock('./_transcription-jobs.js', () => ({
  readTranscriptionJob: vi.fn(async () => null),
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
    vi.mocked((await store()).readTranscriptionJob).mockResolvedValue({
      accountId: ACCOUNT,
      status: 'completed',
      reconcileVerdict: 'exact',
    })

    const { GET } = await route()
    const response = await GET(poll('job-1'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jobId: 'job-1',
      status: 'completed',
      reconcileVerdict: 'exact',
    })
    expect(vi.mocked((await store()).readTranscriptionJob)).toHaveBeenCalledWith('job-1')
  })

  it("reads another account's job as missing, so ids cannot be probed", async () => {
    vi.mocked((await store()).readTranscriptionJob).mockResolvedValue({
      accountId: '0x0000000000000000000000000000000000000001',
      status: 'completed',
      reconcileVerdict: 'exact',
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
})
