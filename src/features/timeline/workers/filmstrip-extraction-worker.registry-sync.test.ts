// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  dispatchRegistryPayloads,
  hasErrorResponse,
  stubWorkerShell,
} from '@/infrastructure/browser/worker-registry-sync-test-helpers'

describe('filmstrip extraction worker registry sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.clearAllMocks()
    vi.doUnmock('mediabunny')
    vi.doUnmock('@/infrastructure/browser/mediabunny-input-source')
    vi.doUnmock('@/infrastructure/browser/register-prores-decoder')
  })

  it('ignores registry broadcasts then warms', async () => {
    vi.doMock('mediabunny', () => ({
      Input: class {
        dispose = vi.fn()
      },
      CanvasSink: class {},
      ALL_FORMATS: [],
    }))
    vi.doMock('@/infrastructure/browser/mediabunny-input-source', () => ({
      createMediabunnyInputSource: vi.fn(() => ({})),
    }))
    vi.doMock('@/infrastructure/browser/register-prores-decoder', () => ({
      ensureProResDecoderRegistered: vi.fn(),
    }))

    const posted = stubWorkerShell()
    await import('./filmstrip-extraction-worker')
    const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage
    await dispatchRegistryPayloads(onmessage)
    expect(hasErrorResponse(posted)).toBe(false)
    await onmessage({ data: { type: 'warm', requestId: 'warm-1' } } as MessageEvent)
    await vi.waitFor(() => posted.some((message) => message.type === 'warmed'), { timeout: 3000 })
  })
})