import { describe, expect, it } from 'vitest'
import { PixelsGenerateApiError } from './seedance-client'
import { formatDirectorBatchQuoteError } from './director-batch-quote-errors'

describe('formatDirectorBatchQuoteError', () => {
  it('returns PixelsGenerateApiError message', () => {
    const error = new PixelsGenerateApiError(
      'quote_not_found',
      'Batch quote expired — refresh the quote before paying.',
      400,
    )
    expect(formatDirectorBatchQuoteError(error)).toBe(
      'Batch quote expired — refresh the quote before paying.',
    )
  })

  it('maps raw veo quote failures', () => {
    const error = new Error('veo quote failed for shot shot-3')
    expect(formatDirectorBatchQuoteError(error)).toContain('Veo')
  })

  it('maps feature_disabled strings', () => {
    expect(formatDirectorBatchQuoteError(new Error('feature_disabled'))).toContain('not enabled')
  })
})
