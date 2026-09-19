import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('director batch bridge', () => {
  const originalVercel = process.env.VERCEL

  beforeEach(() => {
    delete process.env.VERCEL
  })

  afterEach(async () => {
    const { __resetDirectorBatchStoreForTest } = await import(
      '../../../../api/_director-batch-store'
    )
    __resetDirectorBatchStoreForTest()
    if (originalVercel === undefined) {
      delete process.env.VERCEL
    } else {
      process.env.VERCEL = originalVercel
    }
  })

  describe('mapDirectorShotToGenerate', () => {
    it('maps storyboard fields and clamps durations', async () => {
      const { mapDirectorShotToGenerate, pickDirectorShotProvider } = await import(
        '../../../../api/_director-generate-map'
      )
      const mapped = mapDirectorShotToGenerate({
        shotId: 'shot-1',
        prompt: 'Neon alley chase',
        duration: 7,
        aspectRatio: '9:16',
        consistentCharacter: true,
      })
      expect(mapped?.veoDuration).toBe(6)
      expect(mapped?.seedanceDuration).toBe(7)
      expect(mapped?.aspect_ratio).toBe('9:16')
      expect(pickDirectorShotProvider({ consistentCharacter: true }, 'veo')).toBe('seedance')
    })
  })

  describe('quoteDirectorStoryboardBatch', () => {
    it('returns per-shot and total CRTVAI estimates without charging', async () => {
      const { quoteDirectorStoryboardBatch } = await import(
        '../../../../api/_director-batch-quote-core'
      )
      const result = await quoteDirectorStoryboardBatch({
        wallet: '0xabc',
        shots: [
          { shotId: 'a', prompt: 'Shot A', duration: 5 },
          { shotId: 'b', prompt: 'Shot B', duration: 6, consistentCharacter: true },
        ],
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.quote.shotCount).toBe(2)
      expect(result.quote.totals.recommendedMix.providers).toEqual({ veo: 1, seedance: 1 })
    })

    it('rejects duplicate shotId in quote request', async () => {
      const { quoteDirectorStoryboardBatch } = await import(
        '../../../../api/_director-batch-quote-core'
      )
      const result = await quoteDirectorStoryboardBatch({
        wallet: '0xabc',
        shots: [
          { shotId: 'dup', prompt: 'One', duration: 5 },
          { shotId: 'dup', prompt: 'Two', duration: 6 },
        ],
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('duplicate shotId')
    })
  })

  describe('bindDirectorBatchSelections', () => {
    it('requires bijection between quote shots and selections', async () => {
      const { quoteDirectorStoryboardBatch, bindDirectorBatchSelections } = await import(
        '../../../../api/_director-batch-quote-core'
      )
      const { getDirectorBatchQuote } = await import('../../../../api/_director-batch-store')

      const quoted = await quoteDirectorStoryboardBatch({
        wallet: '0xabc',
        shots: [
          { shotId: 'a', prompt: 'A', duration: 5 },
          { shotId: 'b', prompt: 'B', duration: 5 },
        ],
      })
      expect(quoted.ok).toBe(true)
      if (!quoted.ok) return
      const stored = await getDirectorBatchQuote(quoted.quote.batchQuoteId)
      expect(stored).toBeTruthy()
      if (!stored) return

      expect(
        bindDirectorBatchSelections(stored, '0xabc', [
          { shotId: 'a', provider: 'veo' },
          { shotId: 'a', provider: 'seedance' },
        ]),
      ).toEqual({ ok: false, error: 'selection_mismatch' })

      expect(
        bindDirectorBatchSelections(stored, '0xabc', [{ shotId: 'a', provider: 'veo' }]),
      ).toEqual({ ok: false, error: 'selection_mismatch' })

      expect(
        bindDirectorBatchSelections(stored, '0xabc', [
          { shotId: 'a', provider: 'veo' },
          { shotId: 'b', provider: 'seedance' },
        ]),
      ).toMatchObject({ ok: true })
    })
  })

  describe('confirmDirectorStoryboardBatch', () => {
    it('rejects quote reuse after first confirm', async () => {
      const { quoteDirectorStoryboardBatch } = await import(
        '../../../../api/_director-batch-quote-core'
      )
      const { confirmDirectorStoryboardBatch } = await import(
        '../../../../api/_director-batch-confirm-core'
      )

      const quoted = await quoteDirectorStoryboardBatch({
        wallet: '0xabc',
        shots: [{ shotId: 'shot-1', prompt: 'Test', duration: 5 }],
      })
      expect(quoted.ok).toBe(true)
      if (!quoted.ok) return

      const first = await confirmDirectorStoryboardBatch({
        wallet: '0xabc',
        batchQuoteId: quoted.quote.batchQuoteId,
        selections: [{ shotId: 'shot-1', provider: 'veo', requestId: 'req-1' }],
      })
      expect(first.ok).toBe(true)

      const second = await confirmDirectorStoryboardBatch({
        wallet: '0xabc',
        batchQuoteId: quoted.quote.batchQuoteId,
        selections: [{ shotId: 'shot-1', provider: 'veo', requestId: 'req-2' }],
      })
      expect(second.ok).toBe(false)
      if (second.ok) return
      expect(second.error).toBe('quote_already_confirmed')
    })
  })

  describe('batch shot claim', () => {
    it('allows only one claim per batchConfirmId + shotId', async () => {
      const {
        saveDirectorBatchConfirm,
        tryClaimDirectorBatchShot,
        releaseDirectorBatchShotClaim,
      } = await import('../../../../api/_director-batch-store')

      const confirm = await saveDirectorBatchConfirm({
        batchQuoteId: 'quote-1',
        wallet: '0xabc',
        paymentTxHash: null,
        totalCrtvaiWei: '1000',
        shots: [{ shotId: 's1', provider: 'veo', requestId: 'r1' }],
      })

      const first = await tryClaimDirectorBatchShot({
        batchConfirmId: confirm.batchConfirmId,
        shotId: 's1',
        requestId: 'r1',
      })
      expect(first).toEqual({ ok: true })

      const second = await tryClaimDirectorBatchShot({
        batchConfirmId: confirm.batchConfirmId,
        shotId: 's1',
        requestId: 'r1',
      })
      expect(second).toEqual({ ok: false, error: 'batch_shot_already_started' })

      await releaseDirectorBatchShotClaim(confirm.batchConfirmId, 's1')

      const third = await tryClaimDirectorBatchShot({
        batchConfirmId: confirm.batchConfirmId,
        shotId: 's1',
        requestId: 'r1',
      })
      expect(third).toEqual({ ok: true })
    })
  })

  describe('bindBatchConfirmShot', () => {
    it('validates wallet and shot binding without started flag', async () => {
      const { bindBatchConfirmShot } = await import('../../../../api/_pixels-generate-billing-core')
      expect(
        bindBatchConfirmShot(
          {
            batchConfirmId: 'c1',
            wallet: '0xabc',
            paymentTxHash: '0xpay',
            shots: [{ shotId: 's1', requestId: 'r1', provider: 'veo', started: true }],
          },
          's1',
          'r1',
          '0xabc',
        ),
      ).toEqual({ ok: true, paymentTxHash: '0xpay' })
    })
  })
})
