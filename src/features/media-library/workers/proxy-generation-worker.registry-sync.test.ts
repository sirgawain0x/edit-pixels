// @vitest-environment node

import { afterEach, describe, it, vi } from 'vite-plus/test'
import { expectRegistryIgnoredBeforeJob } from '@/infrastructure/browser/worker-registry-sync-test-helpers'

describe('proxy generation worker registry sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.doUnmock('mediabunny')
    vi.doUnmock('@/infrastructure/browser/register-prores-decoder')
  })

  it('ignores registry broadcasts then accepts cancel', async () => {
    vi.doMock('mediabunny', () => ({
      Input: class {
        dispose = vi.fn()
      },
      Conversion: class {},
      ALL_FORMATS: [],
    }))
    vi.doMock('@/infrastructure/browser/register-prores-decoder', () => ({
      ensureProResDecoderRegistered: vi.fn(),
    }))

    await expectRegistryIgnoredBeforeJob(
      () => import('./proxy-generation-worker'),
      async (onmessage) => {
        await onmessage({
          data: { type: 'cancel', mediaId: 'media-proxy-cancel' },
        } as MessageEvent)
      },
    )
  })
})