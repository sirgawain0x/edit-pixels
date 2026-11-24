// @vitest-environment node

import { afterEach, describe, it, vi } from 'vite-plus/test'
import { expectRegistryIgnoredBeforeJob } from '@/infrastructure/browser/worker-registry-sync-test-helpers'

describe('transcription decoder worker registry sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.doUnmock('mediabunny')
  })

  it('ignores registry broadcasts then accepts pause', async () => {
    vi.doMock('mediabunny', () => ({
      Input: class {
        dispose = vi.fn()
      },
      BlobSource: class {},
      EncodedPacketSink: class {},
      ALL_FORMATS: [],
    }))

    await expectRegistryIgnoredBeforeJob(
      () => import('./decoder.worker'),
      async (onmessage) => {
        await onmessage({ data: { type: 'pause' } } as MessageEvent)
      },
    )
  })
})