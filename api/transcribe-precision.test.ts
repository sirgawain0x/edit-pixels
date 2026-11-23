import { beforeEach, describe, expect, it, vi } from 'vitest'

const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'

vi.mock('./_pixels-generate-route-auth.js', () => ({
  // The real helper parses the JSON body and hands it back, so the mock must too.
  authenticateGenerativePost: vi.fn(async (request: Request) => ({
    ok: true,
    signer: '0x04f5c5691e2f3e79246b08b98e912b3d2a786696',
    payer: '0x04f5c5691e2f3e79246b08b98e912b3d2a786696',
    body: (await request.clone().json()) as Record<string, unknown>,
  })),
}))

vi.mock('./_rate-limit.js', () => ({
  checkPixelsRateLimits: vi.fn(async () => null),
}))

const CURVE = { supplyWei: 1_000_000_000_000_000_000_000n, balancePooledUsdc6: 5_000_000n }

/** Full `MetokenUsdQuote` shape; the route only forwards four of these fields. */
function mockQuote() {
  return {
    quoteId: 'quote-1',
    signature: 'signed-quote',
    estimatedUsdc6: 198_000,
    minCrtvaiWei: 950_000_000_000_000_000n,
    expiresAtMs: 1_800_000,
    slippageBps: 250,
    curve: CURVE,
  }
}

vi.mock('./_metoken-curve-quote.js', () => ({
  quoteCrtvaiForUsdc6: vi.fn(async () => ({
    quoteId: 'quote-1',
    signature: 'signed-quote',
    estimatedUsdc6: 198_000,
    minCrtvaiWei: 950_000_000_000_000_000n,
    expiresAtMs: 1_800_000,
    slippageBps: 250,
    curve: { supplyWei: 1_000_000_000_000_000_000_000n, balancePooledUsdc6: 5_000_000n },
  })),
}))

vi.mock('./_transcription-jobs.js', () => ({
  transcriptionMonthKey: (atMs: number) => new Date(atMs).toISOString().slice(0, 7),
  countFreeRunsThisMonth: vi.fn(async () => 0),
  createQuotedTranscriptionJob: vi.fn(async () => true),
  attachQuoteToTranscriptionJob: vi.fn(async () => true),
  markTranscriptionJobFailed: vi.fn(async () => true),
}))

async function route() {
  return import('./transcribe-precision.js')
}

async function store() {
  return import('./_transcription-jobs.js')
}

async function quoteModule() {
  return import('./_metoken-curve-quote.js')
}

function planOf(seconds: number, parts = 1) {
  const partSeconds = seconds / parts
  return Array.from({ length: parts }, (_, index) => ({
    startSec: index * partSeconds,
    endSec: (index + 1) * partSeconds,
    overlapSec: 0,
    forcedCut: false,
    vadSpeechSeconds: partSeconds * 0.9,
  }))
}

async function start(body: Record<string, unknown>): Promise<Response> {
  const { POST } = await route()
  return POST(
    new Request('https://pixels.test/api/transcribe-precision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const BASE = {
  mediaId: 'media-1',
  model: 'chirp-3',
  glossary: '',
}

beforeEach(async () => {
  const jobs = await store()
  vi.mocked(jobs.countFreeRunsThisMonth).mockReset()
  vi.mocked(jobs.countFreeRunsThisMonth).mockResolvedValue(0)
  vi.mocked(jobs.createQuotedTranscriptionJob).mockReset()
  vi.mocked(jobs.createQuotedTranscriptionJob).mockResolvedValue(true)
  vi.mocked(jobs.attachQuoteToTranscriptionJob).mockReset()
  vi.mocked(jobs.attachQuoteToTranscriptionJob).mockResolvedValue(true)
  vi.mocked(jobs.markTranscriptionJobFailed).mockReset()
  vi.mocked(jobs.markTranscriptionJobFailed).mockResolvedValue(true)

  const quotes = await quoteModule()
  vi.mocked(quotes.quoteCrtvaiForUsdc6).mockReset()
  vi.mocked(quotes.quoteCrtvaiForUsdc6).mockResolvedValue(mockQuote())
})

describe('POST /api/transcribe-precision — free run', () => {
  it('grants a short run for free and still records the job', async () => {
    const response = await start({ ...BASE, sourceDurationSec: 300, plan: planOf(300) })
    const body = (await response.json()) as { jobId: string; free: boolean; quote?: unknown }

    expect(response.status).toBe(200)
    expect(body.free).toBe(true)
    expect(body.quote).toBeUndefined()

    const jobs = await store()
    expect(vi.mocked(jobs.createQuotedTranscriptionJob)).toHaveBeenCalledTimes(1)
    const created = vi.mocked(jobs.createQuotedTranscriptionJob).mock.calls[0]?.[0]
    expect(created).toMatchObject({
      accountId: ACCOUNT,
      mediaId: 'media-1',
      estimatedUsdc6: 0,
      submittedSecondsCeil: 300,
      plannedParts: 1,
    })
    // The free-run bucket is recorded so the next call sees it.
    expect(created?.freeRunMonth).toMatch(/^\d{4}-\d{2}$/)
    expect(vi.mocked(jobs.attachQuoteToTranscriptionJob)).not.toHaveBeenCalled()
  })

  it('refuses to grant a free run when the record could not be written', async () => {
    const jobs = await store()
    vi.mocked(jobs.createQuotedTranscriptionJob).mockResolvedValue(false)

    const response = await start({ ...BASE, sourceDurationSec: 300, plan: planOf(300) })

    // Without the record the free-run counter is blind, so granting would be unlimited.
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'ledger_unavailable' })
  })

  it('stops granting free runs once the monthly allowance is used', async () => {
    const jobs = await store()
    vi.mocked(jobs.countFreeRunsThisMonth).mockResolvedValue(5)

    const response = await start({ ...BASE, sourceDurationSec: 300, plan: planOf(300) })
    const body = (await response.json()) as { free: boolean }

    expect(body.free).toBe(false)
    expect(vi.mocked(jobs.countFreeRunsThisMonth).mock.calls[0]?.[0]).toMatchObject({ cap: 5 })
    const created = vi.mocked(jobs.createQuotedTranscriptionJob).mock.calls[0]?.[0]
    expect(created?.freeRunMonth).toBeNull()
  })
})

describe('POST /api/transcribe-precision — priced run', () => {
  it('mints a quote after writing the record, then pins the quote onto it', async () => {
    const response = await start({ ...BASE, sourceDurationSec: 1200, plan: planOf(1200, 2) })
    const body = (await response.json()) as {
      jobId: string
      free: boolean
      quote: { quoteId: string; estimatedUsdc6: number; minCrtvaiWei: string; expiresAtMs: number }
    }

    expect(response.status).toBe(200)
    expect(body.free).toBe(false)
    expect(body.quote).toEqual({
      quoteId: 'quote-1',
      estimatedUsdc6: 198_000,
      minCrtvaiWei: '950000000000000000',
      expiresAtMs: 1_800_000,
    })

    const quotes = await quoteModule()
    // 20 minutes at $0.0099/min.
    expect(vi.mocked(quotes.quoteCrtvaiForUsdc6)).toHaveBeenCalledWith(198_000, {
      tier: 'transcribe',
      quoteId: body.jobId,
    })

    const jobs = await store()
    const created = vi.mocked(jobs.createQuotedTranscriptionJob).mock.calls[0]?.[0]
    expect(created).toMatchObject({ jobId: body.jobId, estimatedUsdc6: 198_000 })
    expect(vi.mocked(jobs.attachQuoteToTranscriptionJob).mock.calls[0]?.[0]).toEqual({
      jobId: body.jobId,
      quoteId: 'quote-1',
      minCrtvaiWei: '950000000000000000',
      expiresAtMs: 1_800_000,
    })
  })

  it('records the job before the quote is requested', async () => {
    const jobs = await store()
    const quotes = await quoteModule()
    const order: string[] = []
    vi.mocked(jobs.createQuotedTranscriptionJob).mockImplementation(async () => {
      order.push('create')
      return true
    })
    vi.mocked(quotes.quoteCrtvaiForUsdc6).mockImplementation(async () => {
      order.push('quote')
      return mockQuote()
    })

    await start({ ...BASE, sourceDurationSec: 1200, plan: planOf(1200, 2) })

    expect(order).toEqual(['create', 'quote'])
  })

  it('marks the record failed when the quote cannot be minted', async () => {
    const quotes = await quoteModule()
    vi.mocked(quotes.quoteCrtvaiForUsdc6).mockRejectedValue(
      Object.assign(new Error('price above curve capacity'), { code: 'quote_unpayable' }),
    )

    const response = await start({ ...BASE, sourceDurationSec: 1200, plan: planOf(1200, 2) })

    expect(response.status).toBe(400)
    expect((await response.json()) as { error: string }).toMatchObject({ error: 'quote_unpayable' })
    const jobs = await store()
    expect(vi.mocked(jobs.markTranscriptionJobFailed)).toHaveBeenCalledWith(expect.any(String))
    expect(vi.mocked(jobs.attachQuoteToTranscriptionJob)).not.toHaveBeenCalled()
  })

  it('sums part durations and rounds up once for the pinned submitted seconds', async () => {
    // Two 600.4s parts: per-part ceil would say 1202; the pinned total must be ceil(1200.8) = 1201.
    const jobs = await store()
    vi.mocked(jobs.countFreeRunsThisMonth).mockResolvedValue(5)

    await start({
      ...BASE,
      sourceDurationSec: 1200,
      plan: [
        { startSec: 0, endSec: 600.4, overlapSec: 0, forcedCut: false, vadSpeechSeconds: 500 },
        { startSec: 600.4, endSec: 1200.8, overlapSec: 0, forcedCut: false, vadSpeechSeconds: 500 },
      ],
    })

    const created = vi.mocked(jobs.createQuotedTranscriptionJob).mock.calls[0]?.[0]
    expect(created?.submittedSecondsCeil).toBe(1201)
    expect(created?.plannedParts).toBe(2)
  })
})

describe('POST /api/transcribe-precision — pricing basis', () => {
  it('prices on source minutes even when the plan submits more seconds', async () => {
    // Product decision (2026-11): the quote follows the user's source audio length,
    // while submitted seconds are pinned only so COGS can be computed later.
    // Two parts overlapping by 10s: 1210 submitted seconds for 1200s of source.
    const jobs = await store()
    vi.mocked(jobs.countFreeRunsThisMonth).mockResolvedValue(5)

    const response = await start({
      ...BASE,
      sourceDurationSec: 1200,
      plan: [
        { startSec: 0, endSec: 600, overlapSec: 10, forcedCut: false, vadSpeechSeconds: 540 },
        { startSec: 590, endSec: 1200, overlapSec: 0, forcedCut: false, vadSpeechSeconds: 550 },
      ],
    })
    const body = (await response.json()) as { free: boolean }

    // 20 minutes at $0.0099/min, from the source duration alone.
    expect(body.free).toBe(false)
    const quotes = await quoteModule()
    expect(vi.mocked(quotes.quoteCrtvaiForUsdc6)).toHaveBeenCalledWith(198_000, expect.anything())

    const created = vi.mocked(jobs.createQuotedTranscriptionJob).mock.calls[0]?.[0]
    expect(created?.estimatedUsdc6).toBe(198_000)
    // The extra 10 seconds only show up on the cost side.
    expect(created?.submittedSecondsCeil).toBe(1210)
  })
})

describe('POST /api/transcribe-precision — validation', () => {
  it('rejects a source over the hard ceiling without touching the ledger', async () => {
    const response = await start({ ...BASE, sourceDurationSec: 481 * 60, plan: planOf(1200, 2) })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'over hard cap' })
    const jobs = await store()
    expect(vi.mocked(jobs.createQuotedTranscriptionJob)).not.toHaveBeenCalled()
  })

  it('rejects a part longer than BatchRecognize accepts', async () => {
    const response = await start({
      ...BASE,
      sourceDurationSec: 2400,
      plan: [
        { startSec: 0, endSec: 1200.5, overlapSec: 0, forcedCut: false, vadSpeechSeconds: 1000 },
      ],
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid plan' })
  })

  it('rejects a plan that exceeds the source duration', async () => {
    const response = await start({
      ...BASE,
      sourceDurationSec: 600,
      plan: [{ startSec: 0, endSec: 900, overlapSec: 0, forcedCut: false, vadSpeechSeconds: 800 }],
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid plan' })
  })
})
