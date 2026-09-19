import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('director batch bridge', () => {
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

    it('binds batch selections to wallet and provider choices', async () => {
      const { quoteDirectorStoryboardBatch, bindDirectorBatchSelections } = await import(
        '../../../../api/_director-batch-quote-core'
      )
      const { getDirectorBatchQuote } = await import('../../../../api/_director-batch-store')

      const quoted = await quoteDirectorStoryboardBatch({
        wallet: '0xabc',
        shots: [{ shotId: 'shot-1', prompt: 'Test', duration: 5 }],
      })
      expect(quoted.ok).toBe(true)
      if (!quoted.ok) return

      const stored = await getDirectorBatchQuote(quoted.quote.batchQuoteId)
      expect(stored).toBeTruthy()
      if (!stored) return

      expect(
        bindDirectorBatchSelections(stored, '0xabc', [{ shotId: 'shot-1', provider: 'seedance' }]),
      ).toMatchObject({ ok: true })
    })
  })

  describe('bindBatchConfirmShot', () => {
    it('accepts batch-confirmed shots and rejects double start', async () => {
      const { bindBatchConfirmShot } = await import('../../../../api/_pixels-generate-billing-core')
      expect(
        bindBatchConfirmShot(
          {
            batchConfirmId: 'c1',
            wallet: '0xabc',
            paymentTxHash: '0xpay',
            shots: [{ shotId: 's1', requestId: 'r1', provider: 'veo' }],
          },
          's1',
          'r1',
          '0xabc',
        ),
      ).toEqual({ ok: true, paymentTxHash: '0xpay' })

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
      ).toEqual({ ok: false, error: 'batch_shot_already_started' })
    })
  })
})
