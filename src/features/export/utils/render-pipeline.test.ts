// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import type { ClientExportSettings, ClientRenderResult } from './client-renderer'
import { runRender } from './render-pipeline'

const mocks = vi.hoisted(() => ({ render: vi.fn(), sign: vi.fn() }))
vi.mock('./canvas-render-orchestrator', () => ({
  renderComposition: mocks.render,
  renderAudioOnly: mocks.render,
}))
vi.mock('./c2pa-sign', () => ({ signRenderResultIfConfigured: mocks.sign }))

class SilentWorker {
  static instance: SilentWorker
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn<(message: { requestId: string }) => void>()
  constructor() {
    SilentWorker.instance = this
  }
}

const rendered = {
  blob: new Blob(['video']),
  fileSize: 5,
  duration: 1,
  mimeType: 'video/mp4',
} as ClientRenderResult
const args = () => ({
  clientSettings: {} as ClientExportSettings,
  exportMode: 'video' as const,
  composition: { tracks: [] } as unknown as CompositionInputProps,
  signal: new AbortController().signal,
  onProgress: vi.fn(),
})

describe('export worker startup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', SilentWorker)
    mocks.render.mockResolvedValue(rendered)
    mocks.sign.mockImplementation(({ result }: { result: ClientRenderResult }) => result)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('terminates a silent worker and renders on the main thread', async () => {
    const outcome = runRender(args())
    await vi.advanceTimersByTimeAsync(30000)
    await expect(outcome).resolves.toMatchObject({ renderPath: 'main-thread', result: rendered })
    expect(SilentWorker.instance.terminate).toHaveBeenCalledTimes(1)
    expect(mocks.render).toHaveBeenCalledTimes(1)
  })

  it('cancels immediately without waiting for the worker to acknowledge', async () => {
    const controller = new AbortController()
    const outcome = runRender({ ...args(), signal: controller.signal })
    const rejected = expect(outcome).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(SilentWorker.instance.terminate).toHaveBeenCalledTimes(1)
    expect(mocks.render).not.toHaveBeenCalled()
  })

  it('allows a responding worker to render longer than the startup deadline', async () => {
    const outcome = runRender(args())
    const worker = SilentWorker.instance
    const requestId = worker.postMessage.mock.calls[0]![0].requestId
    worker.onmessage!({
      data: { type: 'progress', requestId, progress: { phase: 'preparing', progress: 0 } },
    } as MessageEvent)
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.render).not.toHaveBeenCalled()
    worker.onmessage!({ data: { type: 'complete', requestId, result: rendered } } as MessageEvent)
    await expect(outcome).resolves.toMatchObject({ renderPath: 'worker' })
  })
})
