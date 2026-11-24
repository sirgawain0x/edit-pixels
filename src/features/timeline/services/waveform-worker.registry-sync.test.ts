// @vitest-environment node

import { afterEach, describe, it, vi } from 'vite-plus/test'
import { expectRegistryIgnoredBeforeJob } from '@/infrastructure/browser/worker-registry-sync-test-helpers'

describe('waveform worker registry sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.doUnmock('mediabunny')
    vi.doUnmock('@/infrastructure/browser/mediabunny-input-source')
    vi.doUnmock('@/shared/utils/ac3-decoder')
  })

  it('ignores registry broadcasts then accepts abort', async () => {
    vi.doMock('mediabunny', () => ({
      Input: class {
        dispose = vi.fn()
      },
      AudioSampleSink: class {},
      ALL_FORMATS: [],
    }))
    vi.doMock('@/infrastructure/browser/mediabunny-input-source', () => ({
      createMediabunnyInputSource: vi.fn(() => ({})),
    }))
    vi.doMock('@/shared/utils/ac3-decoder', () => ({
      ensureAc3DecoderRegistered: vi.fn(),
      isAc3AudioCodec: vi.fn(() => false),
    }))

    await expectRegistryIgnoredBeforeJob(
      () => import('./waveform-worker'),
      async (onmessage) => {
        await onmessage({ data: { type: 'abort', requestId: 'wave-abort' } } as MessageEvent)
      },
    )
  })
})