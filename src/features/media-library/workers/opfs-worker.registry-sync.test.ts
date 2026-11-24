// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  dispatchRegistryPayloads,
  hasErrorResponse,
  stubWorkerShell,
} from '@/infrastructure/browser/worker-registry-sync-test-helpers'

describe('OPFS worker registry sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('ignores registry broadcasts then lists files', async () => {
    const leafDir = { entries: async function* () {} }
    const root = {
      getDirectoryHandle: vi.fn(async (name: string) => {
        if (name === 'media') return leafDir
        throw Object.assign(new Error('missing'), { name: 'NotFoundError' })
      }),
    }
    vi.stubGlobal('navigator', {
      storage: { getDirectory: vi.fn(async () => root) },
    })

    const posted = stubWorkerShell()
    await import('./opfs-worker')
    const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage
    await dispatchRegistryPayloads(onmessage)
    expect(hasErrorResponse(posted)).toBe(false)

    const portMessages: unknown[] = []
    const port = { postMessage: vi.fn((message: unknown) => portMessages.push(message)) }
    await onmessage({
      data: { type: 'list', payload: { directory: 'media' } },
      ports: [port],
    } as unknown as MessageEvent)
    await vi.waitFor(() => portMessages.length > 0, { timeout: 3000 })
    expect(portMessages[0]).toEqual({ success: true, data: [] })
  })
})