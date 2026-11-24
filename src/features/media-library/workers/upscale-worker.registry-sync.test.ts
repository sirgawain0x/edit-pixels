// @vitest-environment node

import { afterEach, describe, it, vi } from 'vite-plus/test'
import { expectRegistryIgnoredBeforeJob } from '@/infrastructure/browser/worker-registry-sync-test-helpers'

describe('upscale worker registry sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.doUnmock('@/infrastructure/upscale')
    vi.doUnmock('@/features/media-library/workers/render-support')
    vi.doUnmock('@/infrastructure/browser/register-prores-decoder')
  })

  it('ignores registry broadcasts then accepts cancel', async () => {
    vi.doMock('@/infrastructure/upscale', () => ({
      Anime4kUpscaler: class {},
      clampUpscaleRenderSize: vi.fn(),
    }))
    vi.doMock('@/features/media-library/workers/render-support', () => ({
      Cancelled: class extends Error {},
      CancellationRegistry: class {
        cancel = vi.fn()
        clear = vi.fn()
        isCancelled = vi.fn(() => false)
      },
      OpfsScratch: class {
        remove = vi.fn()
      },
    }))
    vi.doMock('@/infrastructure/browser/register-prores-decoder', () => ({
      ensureProResDecoderRegistered: vi.fn(),
    }))

    await expectRegistryIgnoredBeforeJob(
      () => import('./upscale-worker'),
      async (onmessage) => {
        await onmessage({ data: { type: 'cancel', jobId: 'upscale-cancel' } } as MessageEvent)
      },
    )
  })
})