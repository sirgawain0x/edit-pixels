import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('pixels generate billing', () => {
  describe('bindSeedanceQuote', () => {
    it('rejects missing or expired quote ids', async () => {
      const { bindSeedanceQuote } = await import('../../../../api/_pixels-generate-billing-core')
      expect(bindSeedanceQuote('', null, 5, '720p')).toEqual({ ok: false, error: 'quote_mismatch' })
      expect(bindSeedanceQuote('q-1', null, 5, '720p')).toEqual({
        ok: false,
        error: 'quote_mismatch',
      })
    })

    it('rejects duration or resolution mismatch', async () => {
      const { bindSeedanceQuote } = await import('../../../../api/_pixels-generate-billing-core')
      const quote = { quoteId: 'q-1', duration: 5, resolution: '720p' as const }
      expect(bindSeedanceQuote('q-1', quote, 8, '720p')).toEqual({
        ok: false,
        error: 'quote_mismatch',
      })
      expect(bindSeedanceQuote('q-1', quote, 5, '480p')).toEqual({
        ok: false,
        error: 'quote_mismatch',
      })
    })

    it('accepts a matching quote', async () => {
      const { bindSeedanceQuote } = await import('../../../../api/_pixels-generate-billing-core')
      const quote = { quoteId: 'q-1', duration: 5, resolution: '720p' as const }
      expect(bindSeedanceQuote('q-1', quote, 5, '720p')).toEqual({ ok: true, quote })
    })
  })

  describe('canCancelPixelsGenerateJob', () => {
    it('allows cancel only while processing without output', async () => {
      const { canCancelPixelsGenerateJob } = await import('../../../../api/_pixels-generate-payment')
      expect(
        canCancelPixelsGenerateJob({
          id: 'j1',
          wallet: '0xabc',
          provider: 'seedance',
          status: 'processing',
          progress: 0,
          model: 'm',
          updatedAtMs: Date.now(),
        }),
      ).toBe(true)
      expect(
        canCancelPixelsGenerateJob({
          id: 'j1',
          wallet: '0xabc',
          provider: 'seedance',
          status: 'completed',
          progress: 100,
          model: 'm',
          output: { video_url: 'https://example.com/v.mp4' },
          updatedAtMs: Date.now(),
        }),
      ).toBe(false)
    })
  })

  describe('releasePixelsGenerateJobPayment', () => {
    const originalVercel = process.env.VERCEL

    beforeEach(() => {
      delete process.env.VERCEL
      vi.resetModules()
    })

    afterEach(() => {
      if (originalVercel === undefined) {
        delete process.env.VERCEL
      } else {
        process.env.VERCEL = originalVercel
      }
      vi.restoreAllMocks()
    })

    it('releases payment once and is idempotent', async () => {
      const releaseFlowPayment = vi.fn().mockResolvedValue(undefined)
      vi.doMock('../../../../api/flow-billing.js', () => ({
        releaseFlowPayment,
      }))

      const jobs = await import('../../../../api/_pixels-generate-jobs')
      const payment = await import('../../../../api/_pixels-generate-payment')
      jobs.__resetPixelsGenerateJobsForTest()

      await jobs.registerPixelsGenerateJob({
        id: 'req-1',
        wallet: '0xabc',
        provider: 'veo',
        status: 'processing',
        progress: 0,
        model: 'veo',
        paymentTxHash: '0xpay',
      })

      expect(await payment.releasePixelsGenerateJobPayment('req-1')).toBe(true)
      expect(releaseFlowPayment).toHaveBeenCalledTimes(1)
      expect(await payment.releasePixelsGenerateJobPayment('req-1')).toBe(false)
      expect(releaseFlowPayment).toHaveBeenCalledTimes(1)

      const job = await jobs.getPixelsGenerateJob('req-1')
      expect(job?.paymentReleased).toBe(true)
    })
  })

  describe('syncPixelsVeoJobFromPoll', () => {
    const originalVercel = process.env.VERCEL

    beforeEach(() => {
      delete process.env.VERCEL
      vi.resetModules()
    })

    afterEach(() => {
      if (originalVercel === undefined) {
        delete process.env.VERCEL
      } else {
        process.env.VERCEL = originalVercel
      }
      vi.restoreAllMocks()
    })

    it('marks job failed and releases payment on terminal Veo failure', async () => {
      const releaseFlowPayment = vi.fn().mockResolvedValue(undefined)
      vi.doMock('../../../../api/flow-billing.js', () => ({
        releaseFlowPayment,
      }))

      const jobs = await import('../../../../api/_pixels-generate-jobs')
      const sync = await import('../../../../api/_pixels-generate-veo-sync')
      jobs.__resetPixelsGenerateJobsForTest()

      await jobs.registerPixelsGenerateJob({
        id: 'req-veo',
        wallet: '0xabc',
        provider: 'veo',
        status: 'processing',
        progress: 0,
        model: 'veo',
        paymentTxHash: '0xpay',
        veoTaskId: 'veo-task-1',
      })

      await sync.syncPixelsVeoJobFromPoll('veo-task-1', {
        id: 'veo-task-1',
        status: 'failed',
        progress: 0,
        model: 'veo',
        error: { code: 'generation_failed', message: 'Vertex failed', type: 'vertex' },
      })

      const job = await jobs.getPixelsGenerateJob('req-veo')
      expect(job?.status).toBe('failed')
      expect(job?.paymentReleased).toBe(true)
      expect(releaseFlowPayment).toHaveBeenCalledWith('0xpay')
    })
  })
})
