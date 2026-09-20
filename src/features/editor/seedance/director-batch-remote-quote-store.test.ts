import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DirectorBatchQuoteResponse } from './seedance-client'
import {
  clearDirectorBatchRemoteQuote,
  loadDirectorBatchRemoteQuote,
  saveDirectorBatchRemoteQuote,
} from './director-batch-remote-quote-store'

const mockQuote = (): DirectorBatchQuoteResponse => ({
  batchQuoteId: 'server-quote-uuid',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  shotCount: 1,
  shots: [],
  totals: {
    allVeo: { crtvaiRequired: '1', crtvaiDisplay: 1, formattedUsd: '$1.00' },
    allSeedance: { crtvaiRequired: '1', crtvaiDisplay: 1, formattedUsd: '$1.00' },
    recommendedMix: {
      crtvaiRequired: '1',
      crtvaiDisplay: 1,
      formattedUsd: '$1.00',
      providers: { veo: 1, seedance: 0 },
    },
  },
})

describe('director-batch-remote-quote-store', () => {
  beforeEach(() => {
    clearDirectorBatchRemoteQuote()
  })

  afterEach(() => {
    clearDirectorBatchRemoteQuote()
  })

  it('persists server batchQuoteId keyed by shotsKey', () => {
    saveDirectorBatchRemoteQuote({
      shotsKey: 'shot-1,shot-2',
      quote: mockQuote(),
      savedAtMs: Date.now(),
    })
    const loaded = loadDirectorBatchRemoteQuote('shot-1,shot-2')
    expect(loaded?.quote.batchQuoteId).toBe('server-quote-uuid')
  })

  it('ignores quotes for a different shotsKey', () => {
    saveDirectorBatchRemoteQuote({
      shotsKey: 'shot-1',
      quote: mockQuote(),
      savedAtMs: Date.now(),
    })
    expect(loadDirectorBatchRemoteQuote('shot-2')).toBeNull()
  })
})
