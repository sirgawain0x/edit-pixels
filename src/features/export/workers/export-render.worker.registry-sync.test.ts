// @vitest-environment node

import { afterEach, describe, it, vi } from 'vite-plus/test'
import { expectRegistryIgnoredBeforeJob } from '@/infrastructure/browser/worker-registry-sync-test-helpers'

describe('export render worker registry sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('ignores registry broadcasts then accepts cancel', async () => {
    await expectRegistryIgnoredBeforeJob(
      () => import('./export-render.worker'),
      async (onmessage) => {
        await onmessage({ data: { type: 'cancel', requestId: 'export-cancel' } } as MessageEvent)
      },
    )
  })
})