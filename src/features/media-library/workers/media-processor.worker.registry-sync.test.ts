// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  dispatchRegistryPayloads,
  hasErrorResponse,
  stubWorkerShell,
} from '@/infrastructure/browser/worker-registry-sync-test-helpers'

describe('media processor worker registry sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.doUnmock('mediabunny')
    vi.doUnmock('@/infrastructure/browser/register-prores-decoder')
  })

  it('ignores registry broadcasts and unknown job types', async () => {
    vi.doMock('mediabunny', () => ({
      Input: class {
        dispose = vi.fn()
      },
      ALL_FORMATS: [],
    }))
    vi.doMock('@/infrastructure/browser/register-prores-decoder', () => ({
      ensureProResDecoderRegistered: vi.fn(),
    }))

    const posted = stubWorkerShell()
    await import('./media-processor.worker')
    const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage
    await dispatchRegistryPayloads(onmessage)
    expect(hasErrorResponse(posted)).toBe(false)

    const before = posted.length
    await onmessage({
      data: { type: 'not-a-real-type', requestId: 'ignored' },
    } as MessageEvent)
    expect(posted.length).toBe(before)
  })
})