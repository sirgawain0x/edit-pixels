// @vitest-environment node

import { afterEach, describe, it, vi } from 'vite-plus/test'
import { expectRegistryIgnoredBeforeJob } from '@/infrastructure/browser/worker-registry-sync-test-helpers'

describe('adaptive scene detection worker registry sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.doUnmock('@/infrastructure/browser/mediabunny-input-source')
    vi.doUnmock('@/infrastructure/browser/register-prores-decoder')
    vi.doUnmock('@/infrastructure/analysis/adaptive-scene-detector')
  })

  it('ignores registry broadcasts then accepts abort', async () => {
    vi.doMock('@/infrastructure/browser/mediabunny-input-source', () => ({
      createMediabunnyInputSource: vi.fn(() => ({})),
    }))
    vi.doMock('@/infrastructure/browser/register-prores-decoder', () => ({
      ensureProResDecoderRegistered: vi.fn(),
    }))
    vi.doMock('@/infrastructure/analysis/adaptive-scene-detector', () => ({
      classifyAdaptiveSceneCuts: vi.fn(() => []),
      compareFrameFeatures: vi.fn(),
      extractFrameFeatures: vi.fn(),
    }))

    await expectRegistryIgnoredBeforeJob(
      () => import('./adaptive-scene-detection-worker'),
      async (onmessage) => {
        await onmessage({ data: { type: 'abort', requestId: 'scene-abort' } } as MessageEvent)
      },
    )
  })
})