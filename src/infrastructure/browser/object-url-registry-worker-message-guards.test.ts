// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  ADD_OBJECT_URL,
  REMOVE_OBJECT_URL,
  SYNC_OBJECT_URL_REGISTRY,
} from './object-url-registry'

type PostedMessage = { type: string; [key: string]: unknown }

function registryBroadcastPayloads(): Array<Record<string, unknown>> {
  return [
    {
      type: SYNC_OBJECT_URL_REGISTRY,
      entries: [{ url: 'blob:reg', blob: new Blob(['reg']) }],
    },
    { type: ADD_OBJECT_URL, url: 'blob:add', blob: new Blob(['add']) },
    { type: REMOVE_OBJECT_URL, url: 'blob:remove' },
  ]
}

function stubWorkerShell() {
  const posted: PostedMessage[] = []
  const messageListeners: Array<(event: MessageEvent) => void> = []
  vi.stubGlobal('self', {
    postMessage: vi.fn((message: PostedMessage) => {
      posted.push(message)
    }),
    onmessage: null as ((event: MessageEvent) => void | Promise<void>) | null,
    addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
      if (type === 'message') messageListeners.push(listener)
    }),
    removeEventListener: vi.fn(),
    dispatchMessage(event: MessageEvent) {
      for (const listener of messageListeners) listener(event)
    },
  })
  return posted
}

function hasErrorResponse(posted: PostedMessage[]): boolean {
  return posted.some((message) => message.type === 'error')
}

async function dispatchRegistryPayloads(
  onmessage: (event: MessageEvent) => void | Promise<void>,
): Promise<void> {
  for (const payload of registryBroadcastPayloads()) {
    await onmessage({ data: payload } as MessageEvent)
  }
}

describe('worker object-URL registry message guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.clearAllMocks()
    vi.doUnmock('mediabunny')
    vi.doUnmock('@/infrastructure/browser/mediabunny-input-source')
    vi.doUnmock('@/infrastructure/browser/register-prores-decoder')
    vi.doUnmock('@/infrastructure/interpolation')
    vi.doUnmock('@/features/media-library/workers/render-support')
    vi.doUnmock('@/infrastructure/upscale')
    vi.doUnmock('@/shared/utils/ac3-decoder')
    vi.doUnmock('@/infrastructure/analysis/adaptive-scene-detector')
  })

  it('filmstrip extraction worker', async () => {
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
    await import('@/features/timeline/workers/filmstrip-extraction-worker')
    const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage

    await dispatchRegistryPayloads(onmessage)
    expect(hasErrorResponse(posted)).toBe(false)

    await onmessage({ data: { type: 'warm', requestId: 'warm-1' } } as MessageEvent)
    await vi.waitFor(() => posted.some((message) => message.type === 'warmed'), { timeout: 3000 })
  })

  it('proxy generation worker', async () => {
    vi.doMock('mediabunny', () => ({
      Input: class {
        dispose = vi.fn()
      },
      Conversion: class {},
      ALL_FORMATS: [],
    }))
    vi.doMock('@/infrastructure/browser/register-prores-decoder', () => ({
      ensureProResDecoderRegistered: vi.fn(),
    }))

    const posted = stubWorkerShell()
    await import('@/features/media-library/workers/proxy-generation-worker')
    const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage

    await dispatchRegistryPayloads(onmessage)
    expect(hasErrorResponse(posted)).toBe(false)

    const before = posted.length
    await onmessage({
      data: { type: 'cancel', mediaId: 'media-proxy-cancel' },
    } as MessageEvent)
    expect(posted.length).toBe(before)
  })

  it('frame interpolation worker', async () => {
    vi.doMock('@/infrastructure/interpolation', () => ({
      clampRenderSize: vi.fn(),
      interpolateGap: vi.fn(),
      RifeInterpolator: class {},
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

    const posted = stubWorkerShell()
    await import('@/features/media-library/workers/frame-interpolation-worker')
    const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage

    await dispatchRegistryPayloads(onmessage)
    expect(hasErrorResponse(posted)).toBe(false)

    await onmessage({ data: { type: 'cancel', jobId: 'job-cancel' } } as MessageEvent)
    expect(hasErrorResponse(posted)).toBe(false)
  })

  it('upscale worker', async () => {
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

    const posted = stubWorkerShell()
    await import('@/features/media-library/workers/upscale-worker')
    const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage

    await dispatchRegistryPayloads(onmessage)
    expect(hasErrorResponse(posted)).toBe(false)

    await onmessage({ data: { type: 'cancel', jobId: 'upscale-cancel' } } as MessageEvent)
    expect(hasErrorResponse(posted)).toBe(false)
  })

  it('OPFS worker', async () => {
    const leafDir = {
      entries: async function* () {},
    }
    const root = {
      getDirectoryHandle: vi.fn(async (name: string) => {
        if (name === 'media') return leafDir
        throw Object.assign(new Error('missing'), { name: 'NotFoundError' })
      }),
    }
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: vi.fn(async () => root),
      },
    })

    const posted = stubWorkerShell()
    await import('@/features/media-library/workers/opfs-worker')
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

  it('media processor worker', async () => {
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
    await import('@/features/media-library/workers/media-processor.worker')
    const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage

    await dispatchRegistryPayloads(onmessage)
    expect(hasErrorResponse(posted)).toBe(false)

    const before = posted.length
    await onmessage({
      data: { type: 'not-a-real-type', requestId: 'ignored' },
    } as MessageEvent)
    expect(posted.length).toBe(before)
  })

  it('waveform worker', async () => {
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

    const posted = stubWorkerShell()
    await import('@/features/timeline/services/waveform-worker')
    const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage

    await dispatchRegistryPayloads(onmessage)
    expect(hasErrorResponse(posted)).toBe(false)

    await onmessage({ data: { type: 'abort', requestId: 'wave-abort' } } as MessageEvent)
    expect(hasErrorResponse(posted)).toBe(false)
  })

  it('audio decode worker', async () => {
    const posted = stubWorkerShell()
    await import('@/runtime/composition-runtime/utils/audio-decode-worker')
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

  it('export render worker', async () => {
    const posted = stubWorkerShell()
    await import('@/features/export/workers/export-render.worker')
    const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage

    await dispatchRegistryPayloads(onmessage)
    expect(hasErrorResponse(posted)).toBe(false)

    await onmessage({ data: { type: 'cancel', requestId: 'export-cancel' } } as MessageEvent)
    expect(hasErrorResponse(posted)).toBe(false)
  })

  it('transcription decoder worker', async () => {
    vi.doMock('mediabunny', () => ({
      Input: class {
        dispose = vi.fn()
      },
      BlobSource: class {},
      EncodedPacketSink: class {},
      ALL_FORMATS: [],
    }))

    const posted = stubWorkerShell()
    await import('@/features/media-library/transcription/workers/decoder.worker')
    const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage

    await dispatchRegistryPayloads(onmessage)
    expect(hasErrorResponse(posted)).toBe(false)

    await onmessage({ data: { type: 'pause' } } as MessageEvent)
    expect(hasErrorResponse(posted)).toBe(false)
  })

  it('adaptive scene detection worker', async () => {
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

    const posted = stubWorkerShell()
    await import('@/infrastructure/analysis/adaptive-scene-detection-worker')
    const onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage

    await dispatchRegistryPayloads(onmessage)
    expect(hasErrorResponse(posted)).toBe(false)

    await onmessage({ data: { type: 'abort', requestId: 'scene-abort' } } as MessageEvent)
    expect(hasErrorResponse(posted)).toBe(false)
  })
})