import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./_firestore-rest.js', () => ({
  FIRESTORE_REST_TIMEOUT_MS: 8_000,
  encodeFirestoreString: (value: string) => ({ stringValue: value }),
  encodeFirestoreNull: () => ({ nullValue: null }),
  encodeFirestoreNumber: (value: number) => ({ doubleValue: value }),
  encodeFirestoreInteger: (value: number) => ({ integerValue: String(value) }),
  encodeFirestoreTimestamp: (iso = '2026-11-22T00:00:00.000Z') => ({ timestampValue: iso }),
  readFirestoreString: (value?: { stringValue?: string } | null) =>
    value && typeof value.stringValue === 'string' ? value.stringValue : null,
  readFirestoreInteger: (value?: { integerValue?: string } | null) =>
    value && typeof value.integerValue === 'string' ? Number(value.integerValue) : null,
  patchFirestoreDocument: vi.fn(async () => true),
  getFirestoreDocument: vi.fn(async () => null),
  runFirestoreStructuredQuery: vi.fn(async () => []),
}))

const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'

async function store() {
  return import('./_transcription-jobs.js')
}

async function firestore() {
  return import('./_firestore-rest.js')
}

describe('transcriptionMonthKey', () => {
  it('buckets by UTC month so servers in different TZs agree', async () => {
    const { transcriptionMonthKey } = await store()
    // 2026-12-01T02:30Z is still November in New York; the bucket must not follow local time.
    expect(transcriptionMonthKey(Date.parse('2026-12-01T02:30:00.000Z'))).toBe('2026-12')
    expect(transcriptionMonthKey(Date.parse('2026-11-30T23:59:59.000Z'))).toBe('2026-11')
  })
})

describe('countFreeRunsThisMonth', () => {
  beforeEach(async () => {
    vi.mocked((await firestore()).runFirestoreStructuredQuery).mockClear()
  })

  it('counts this account+month with equality-only filters (no composite index needed)', async () => {
    const { runFirestoreStructuredQuery } = await firestore()
    vi.mocked(runFirestoreStructuredQuery).mockResolvedValue([{ name: 'a' }, { name: 'b' }])

    const { countFreeRunsThisMonth } = await store()
    const used = await countFreeRunsThisMonth({ accountId: ACCOUNT, monthKey: '2026-11', cap: 5 })

    expect(used).toBe(2)
    const query = vi.mocked(runFirestoreStructuredQuery).mock.calls[0]?.[0].structuredQuery as {
      from: Array<{ collectionId: string }>
      where: {
        compositeFilter: {
          filters: Array<{
            fieldFilter: { field: { fieldPath: string }; op: string; value: unknown }
          }>
        }
      }
      limit: number
    }
    expect(query.from[0]?.collectionId).toBe('transcription_jobs')
    expect(query.limit).toBe(5)
    const filters = query.where.compositeFilter.filters
    expect(filters).toHaveLength(2)
    expect(filters[0]?.fieldFilter.op).toBe('EQUAL')
    expect(filters[0]?.fieldFilter.field.fieldPath).toBe('accountId')
    expect(filters[0]?.fieldFilter.value).toEqual({ stringValue: ACCOUNT })
    expect(filters[1]?.fieldFilter.field.fieldPath).toBe('freeRunMonth')
    expect(filters[1]?.fieldFilter.value).toEqual({ stringValue: '2026-11' })
    // No orderBy/inequality: that is what keeps this off the composite-index path.
    expect(query).not.toHaveProperty('orderBy')
  })

  it('caps the read at the allowance, so a heavy account cannot inflate the cost', async () => {
    const { runFirestoreStructuredQuery } = await firestore()
    vi.mocked(runFirestoreStructuredQuery).mockResolvedValue([{}, {}, {}, {}, {}])

    const { countFreeRunsThisMonth } = await store()
    const used = await countFreeRunsThisMonth({ accountId: ACCOUNT, monthKey: '2026-11', cap: 5 })

    expect(used).toBe(5)
    expect(vi.mocked(runFirestoreStructuredQuery).mock.calls[0]?.[0].structuredQuery.limit).toBe(5)
  })
})

describe('createQuotedTranscriptionJob', () => {
  it('pins the pricing, abort lines, and settlement clock before payment', async () => {
    const { patchFirestoreDocument } = await firestore()
    vi.mocked(patchFirestoreDocument).mockClear()
    vi.mocked(patchFirestoreDocument).mockResolvedValue(true)

    const { createQuotedTranscriptionJob } = await store()
    const ok = await createQuotedTranscriptionJob({
      jobId: 'job-1',
      accountId: ACCOUNT,
      mediaId: 'media-1',
      estimatedUsdc6: 3_600_000,
      submittedSecondsCeil: 1_201,
      plannedParts: 2,
      quoteCreatedAtMs: 1_000_000,
      settleByMs: 1_900_000,
      freeRunMonth: null,
    })

    expect(ok).toBe(true)
    const write = vi.mocked(patchFirestoreDocument).mock.calls[0]?.[0]
    expect(write?.collection).toBe('transcription_jobs')
    expect(write?.documentId).toBe('job-1')

    const fields = write?.fields ?? {}
    // Rate is the Google batch COGS rate, not the user-facing price.
    expect(fields.rateUsdc6PerSec).toEqual({ integerValue: '50' })
    expect(fields.estimatedUsdc6).toEqual({ integerValue: '3600000' })
    expect(fields.submittedSecondsCeil).toEqual({ integerValue: '1201' })
    expect(fields.abortRatio).toEqual({ doubleValue: 0.8 })
    expect(fields.abortLimitUsdc6).toEqual({ integerValue: '2880000' })
    // Alert line is the same number as the abort line today.
    expect(fields.alertAtUsdc6).toEqual({ integerValue: '2880000' })
    expect(fields.status).toEqual({ stringValue: 'quoted' })
    expect(fields.freeRunMonth).toEqual({ nullValue: null })
    expect(fields.retrySpendUsdc6).toEqual({ integerValue: '0' })
    expect(fields.retryingAt).toEqual({ nullValue: null })
    expect(fields.retryingPartIndex).toEqual({ nullValue: null })
    expect(fields.plannedParts).toEqual({ integerValue: '2' })
    expect(fields.pinnedAt).toEqual({ integerValue: '1000000' })
    expect(fields.settleByMs).toEqual({ integerValue: '1900000' })
    expect(fields.reconcileVerdict).toEqual({ nullValue: null })

    // The retry clock is pinned as a map so threshold retuning cannot rewrite history.
    expect(fields.retryClock).toEqual({
      mapValue: {
        fields: {
          quoteCreatedAtMs: { integerValue: '1000000' },
          settleByMs: { integerValue: '1900000' },
          maxOperationRoundMs: { integerValue: '125000' },
          settleBufferMs: { integerValue: '30000' },
        },
      },
    })
  })

  it('records the free-run month when the run was granted', async () => {
    const { patchFirestoreDocument } = await firestore()
    vi.mocked(patchFirestoreDocument).mockClear()
    vi.mocked(patchFirestoreDocument).mockResolvedValue(true)

    const { createQuotedTranscriptionJob } = await store()
    await createQuotedTranscriptionJob({
      jobId: 'job-free',
      accountId: ACCOUNT,
      mediaId: 'media-1',
      estimatedUsdc6: 0,
      submittedSecondsCeil: 90,
      plannedParts: 1,
      quoteCreatedAtMs: 1_000_000,
      settleByMs: 1_900_000,
      freeRunMonth: '2026-11',
    })

    const fields = vi.mocked(patchFirestoreDocument).mock.calls[0]?.[0].fields ?? {}
    expect(fields.freeRunMonth).toEqual({ stringValue: '2026-11' })
    expect(fields.abortLimitUsdc6).toEqual({ integerValue: '0' })
  })

  it('reports a failed write so the caller can refuse a free run', async () => {
    const { patchFirestoreDocument } = await firestore()
    vi.mocked(patchFirestoreDocument).mockResolvedValue(false)

    const { createQuotedTranscriptionJob } = await store()
    const ok = await createQuotedTranscriptionJob({
      jobId: 'job-2',
      accountId: ACCOUNT,
      mediaId: 'media-1',
      estimatedUsdc6: 7_500,
      submittedSecondsCeil: 60,
      plannedParts: 1,
      quoteCreatedAtMs: 1_000_000,
      settleByMs: 1_900_000,
      freeRunMonth: null,
    })

    expect(ok).toBe(false)
  })
})

describe('attachQuoteToTranscriptionJob', () => {
  it('pins the quote id, minimum CRTVAI, and expiry', async () => {
    const { patchFirestoreDocument } = await firestore()
    vi.mocked(patchFirestoreDocument).mockClear()
    vi.mocked(patchFirestoreDocument).mockResolvedValue(true)

    const { attachQuoteToTranscriptionJob } = await store()
    await attachQuoteToTranscriptionJob({
      jobId: 'job-1',
      quoteId: 'quote-9',
      minCrtvaiWei: '950000000000000000',
      expiresAtMs: 2_000_000,
    })

    const write = vi.mocked(patchFirestoreDocument).mock.calls[0]?.[0]
    expect(write?.documentId).toBe('job-1')
    expect(write?.fields.quoteId).toEqual({ stringValue: 'quote-9' })
    expect(write?.fields.minCrtvaiWei).toEqual({ stringValue: '950000000000000000' })
    expect(write?.fields.quoteExpiresAtMs).toEqual({ integerValue: '2000000' })
  })
})

describe('refundFreeRun', () => {
  it('clears the month and stamps the refund, so the credit counts again', async () => {
    const { patchFirestoreDocument } = await firestore()
    vi.mocked(patchFirestoreDocument).mockClear()
    vi.mocked(patchFirestoreDocument).mockResolvedValue(true)

    const { refundFreeRun } = await store()
    expect(await refundFreeRun('job-free', 1_234_000)).toBe(true)

    const write = vi.mocked(patchFirestoreDocument).mock.calls[0]?.[0]
    expect(write?.documentId).toBe('job-free')
    // The allowance is counted off `freeRunMonth`, so clearing it IS the refund.
    expect(write?.fields.freeRunMonth).toEqual({ nullValue: null })
    // And the audit keeps the fact that a credit was granted and returned.
    expect(write?.fields.freeRunRefundedAt).toEqual({ integerValue: '1234000' })
  })
})

describe('readTranscriptionJob', () => {
  it('maps a stored record to the poll response shape', async () => {
    const { getFirestoreDocument } = await firestore()
    vi.mocked(getFirestoreDocument).mockResolvedValue({
      fields: {
        accountId: { stringValue: ACCOUNT },
        status: { stringValue: 'completed' },
        reconcileVerdict: { stringValue: 'exact' },
      },
    })

    const { readTranscriptionJob } = await store()
    expect(await readTranscriptionJob('job-1')).toEqual({
      accountId: ACCOUNT,
      status: 'completed',
      reconcileVerdict: 'exact',
      quoteId: null,
      minCrtvaiWei: null,
      estimatedUsdc6: null,
      submittedSecondsCeil: null,
      operationName: null,
      glossary: null,
      txHash: null,
      freeRunMonth: null,
    })
  })

  it('reads the quote and submission fields the submit route verifies against', async () => {
    const { getFirestoreDocument } = await firestore()
    vi.mocked(getFirestoreDocument).mockResolvedValue({
      fields: {
        accountId: { stringValue: ACCOUNT },
        status: { stringValue: 'running' },
        quoteId: { stringValue: 'quote-9' },
        minCrtvaiWei: { stringValue: '950000000000000000' },
        estimatedUsdc6: { integerValue: '150000' },
        submittedSecondsCeil: { integerValue: '1200' },
        operationName: { stringValue: 'projects/1/locations/us/operations/abc' },
        txHash: { stringValue: '0xfeed' },
      },
    })

    const { readTranscriptionJob } = await store()
    expect(await readTranscriptionJob('job-1')).toMatchObject({
      quoteId: 'quote-9',
      minCrtvaiWei: '950000000000000000',
      estimatedUsdc6: 150_000,
      submittedSecondsCeil: 1_200,
      operationName: 'projects/1/locations/us/operations/abc',
      glossary: null,
      txHash: '0xfeed',
    })
  })

  it('returns null for a missing record instead of inventing a status', async () => {
    const { getFirestoreDocument } = await firestore()
    vi.mocked(getFirestoreDocument).mockResolvedValue(null)

    const { readTranscriptionJob } = await store()
    expect(await readTranscriptionJob('job-missing')).toBeNull()
  })

  it('treats an unknown status as unreadable rather than guessing', async () => {
    const { getFirestoreDocument } = await firestore()
    vi.mocked(getFirestoreDocument).mockResolvedValue({
      fields: { accountId: { stringValue: ACCOUNT }, status: { stringValue: 'half-written' } },
    })

    const { readTranscriptionJob } = await store()
    expect(await readTranscriptionJob('job-1')).toBeNull()
  })

  it('drops an unrecognised verdict but keeps the status', async () => {
    const { getFirestoreDocument } = await firestore()
    vi.mocked(getFirestoreDocument).mockResolvedValue({
      fields: {
        accountId: { stringValue: ACCOUNT },
        status: { stringValue: 'running' },
        reconcileVerdict: { stringValue: 'made-up' },
      },
    })

    const { readTranscriptionJob } = await store()
    expect(await readTranscriptionJob('job-1')).toEqual({
      accountId: ACCOUNT,
      status: 'running',
      reconcileVerdict: null,
      quoteId: null,
      minCrtvaiWei: null,
      estimatedUsdc6: null,
      submittedSecondsCeil: null,
      operationName: null,
      glossary: null,
      txHash: null,
      freeRunMonth: null,
    })
  })
})
