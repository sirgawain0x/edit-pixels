// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  dispatchRegistryPayloads,
  hasErrorResponse,
  stubWorkerShell,
} from '@/infrastructure/browser/worker-registry-sync-test-helpers'

describe('audio decode worker registry sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('ignores registry broadcasts then assembles bins', async () => {
    const posted = stubWorkerShell()
    await import('./audio-decode-worker')
    const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage
    await dispatchRegistryPayloads(onmessage)
    expect(hasErrorResponse(posted)).toBe(false)

    await onmessage({
      data: {
        type: 'assemble-bins',
        requestId: 'assemble-1',
        totalFrames: 2,
        bins: [
          {
            frames: 2,
            left: new Int16Array([0, 0]).buffer,
            right: new Int16Array([0, 0]).buffer,
          },
        ],
      },
    } as MessageEvent)
    await vi.waitFor(() => posted.some((message) => message.type === 'assembled'), {
      timeout: 3000,
    })
  })
})