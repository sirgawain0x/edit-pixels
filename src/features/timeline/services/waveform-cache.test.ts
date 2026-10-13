// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const getLevelMock = vi.fn()
const deleteMock = vi.fn()
const getCachedRangeMock = vi.fn()
const saveRangeMock = vi.fn()

let workerMessageHandler: ((event: MessageEvent) => void) | null = null

const mockWorker = {
  postMessage: vi.fn(),
  addEventListener: vi.fn((type: string, handler: (event: MessageEvent) => void) => {
    if (type === 'message') {
      workerMessageHandler = handler
    }
  }),
  removeEventListener: vi.fn(),
  terminate: vi.fn(),
}

vi.mock('@/shared/utils/managed-worker', () => ({
  createManagedWorker: () => ({
    getWorker: () => mockWorker as unknown as Worker,
    peekWorker: () => mockWorker as unknown as Worker,
    terminate: vi.fn(),
  }),
}))

vi.mock('./waveform-opfs-storage', () => ({
  chooseLevelForZoom: vi.fn(() => 0),
  WAVEFORM_LEVELS: [500, 100, 25, 10],
  waveformOPFSStorage: {
    getLevel: getLevelMock,
    getCachedRange: getCachedRangeMock,
    saveRange: saveRangeMock,
    delete: deleteMock,
  },
}))

vi.mock('@/infrastructure/storage', () => ({
  getWaveform: vi.fn(async () => undefined),
  getWaveformRecord: vi.fn(async () => undefined),
  getWaveformMeta: vi.fn(async () => undefined),
  getWaveformBins: vi.fn(async () => []),
  saveWaveformBin: vi.fn(async () => undefined),
  saveWaveformMeta: vi.fn(async () => undefined),
  deleteWaveform: vi.fn(async () => undefined),
}))

function getWorkerGenerateRequestId(): string {
  const generateCall = mockWorker.postMessage.mock.calls.find(
    (call) => (call[0] as { type?: string } | undefined)?.type === 'generate',
  )
  const payload = generateCall?.[0] as { requestId?: string } | undefined
  return payload?.requestId ?? ''
}

async function waitForWorkerGenerateRequestId(): Promise<string> {
  await vi.waitFor(() => getWorkerGenerateRequestId().length > 0)
  return getWorkerGenerateRequestId()
}

function dispatchFullTailChunkThenPartialComplete(requestId: string, totalSamples = 100): void {
  workerMessageHandler?.({
    data: {
      type: 'init',
      requestId,
      duration: 3,
      channels: 1,
      stereo: false,
      sampleRate: 500,
      totalSamples,
    },
  } as MessageEvent)
  workerMessageHandler?.({
    data: {
      type: 'chunk',
      requestId,
      startIndex: 0,
      peaks: new Float32Array(totalSamples).fill(0.5),
    },
  } as MessageEvent)
  workerMessageHandler?.({
    data: {
      type: 'complete',
      requestId,
      maxPeak: 0.5,
      partial: true,
    },
  } as MessageEvent)
}

function dispatchPartialWorkerResult(requestId: string, totalSamples = 100): void {
  workerMessageHandler?.({
    data: {
      type: 'init',
      requestId,
      duration: 3,
      channels: 1,
      stereo: false,
      sampleRate: 500,
      totalSamples,
    },
  } as MessageEvent)
  workerMessageHandler?.({
    data: {
      type: 'chunk',
      requestId,
      startIndex: 0,
      peaks: new Float32Array(40).fill(0.5),
    },
  } as MessageEvent)
  workerMessageHandler?.({
    data: {
      type: 'complete',
      requestId,
      maxPeak: 0.5,
      partial: true,
    },
  } as MessageEvent)
}

describe('waveformCache', () => {
  beforeEach(() => {
    workerMessageHandler = null
    mockWorker.postMessage.mockReset()
    mockWorker.addEventListener.mockClear()
    getLevelMock.mockReset()
    getCachedRangeMock.mockReset()
    getCachedRangeMock.mockResolvedValue(null)
    saveRangeMock.mockReset()
    saveRangeMock.mockResolvedValue(undefined)
    deleteMock.mockReset()
  })

  afterEach(async () => {
    const { waveformCache } = await import('./waveform-cache')
    waveformCache.dispose()
  })

  it('preserves stereo channel metadata when loading from OPFS', async () => {
    getLevelMock.mockResolvedValue({
      sampleRate: 500,
      peaks: new Float32Array([0.8, 0.2, 1.0, 0.3]),
      channels: 2,
    })

    const { waveformCache } = await import('./waveform-cache')
    const waveform = await waveformCache.getWaveform('media-stereo', 'blob:unused')

    expect(waveform.channels).toBe(2)
    expect(waveform.stereo).toBe(true)
    expect(waveform.duration).toBeCloseTo(0.004, 6)
    expect(waveform.peaks[0]).toBeCloseTo(0.8, 6)
    expect(waveform.peaks[1]).toBeCloseTo(0.2, 6)
    expect(waveform.peaks[2]).toBeCloseTo(1, 6)
    expect(waveform.peaks[3]).toBeCloseTo(0.3, 6)
  })

  it('loads persisted waveform data without requiring a blob URL', async () => {
    getLevelMock.mockResolvedValue({
      sampleRate: 500,
      peaks: new Float32Array([0.5, 0.25]),
      channels: 1,
    })

    const { waveformCache } = await import('./waveform-cache')
    const waveform = await waveformCache.getCachedWaveform('media-cached')

    expect(waveform).not.toBeNull()
    expect(waveform?.duration).toBeCloseTo(0.004, 6)
    expect(waveform?.peaks[0]).toBeCloseTo(0.5, 6)
    expect(waveform?.peaks[1]).toBeCloseTo(0.25, 6)
  })

  it('hydrates visible waveform ranges from the range cache before decoding', async () => {
    getCachedRangeMock.mockResolvedValue({
      duration: 120,
      channels: 1,
      sampleRate: 100,
      startSample: 100,
      peaks: new Float32Array(12000),
    })

    const { waveformCache } = await import('./waveform-cache')
    const waveform = await waveformCache.prepareVisibleWaveformRange(
      'media-range',
      'blob:unused',
      1,
      3,
      300,
    )

    expect(getCachedRangeMock).toHaveBeenCalledWith('media-range', 100, 1, 3)
    expect(waveform?.sampleRate).toBe(100)
    expect(waveform?.isComplete).toBe(false)
    expect(waveform?.duration).toBe(120)
  })

  it('does not mark progressive updates complete before the worker complete message', async () => {
    const { waveformCache } = await import('./waveform-cache')
    const updates: Array<{ isComplete: boolean; loadedSamples: number }> = []
    waveformCache.subscribe('media-tail-before-complete', (waveform) => {
      updates.push({
        isComplete: waveform.isComplete,
        loadedSamples: waveform.loadedSamples,
      })
    })

    const requestId = 'waveform-cache-tail-before-complete'
    const promise = (
      waveformCache as unknown as {
        generateWaveformWithWorker: (
          mediaId: string,
          blobUrl: string,
          requestId: string,
          onProgress?: (progress: number) => void,
          options?: {
            persistBins?: boolean
            persistOPFS?: boolean
            updateMemoryCache?: boolean
            isComplete?: boolean
          },
        ) => Promise<import('./waveform-cache').CachedWaveform>
      }
    ).generateWaveformWithWorker(
      'media-tail-before-complete',
      'blob:unused',
      requestId,
      undefined,
      {
        persistBins: false,
        persistOPFS: false,
        updateMemoryCache: true,
        isComplete: true,
      },
    )
    await vi.waitFor(() => workerMessageHandler !== null)
    dispatchFullTailChunkThenPartialComplete(requestId, 100)

    const waveform = await promise
    expect(waveform.partial).toBe(true)
    expect(waveform.isComplete).toBe(false)
    expect(updates.some((update) => update.loadedSamples >= 100 && update.isComplete)).toBe(false)
    expect(updates.at(-1)?.isComplete).toBe(false)
  })

  it('keeps partial worker results incomplete in progressive cache updates', async () => {
    const { waveformCache } = await import('./waveform-cache')
    const updates: Array<{ isComplete: boolean; partial?: boolean }> = []
    waveformCache.subscribe('media-partial-worker', (waveform) => {
      updates.push({ isComplete: waveform.isComplete, partial: waveform.partial })
    })

    const requestId = 'waveform-cache-partial-test'
    const promise = (
      waveformCache as unknown as {
        generateWaveformWithWorker: (
          mediaId: string,
          blobUrl: string,
          requestId: string,
          onProgress?: (progress: number) => void,
          options?: {
            persistBins?: boolean
            persistOPFS?: boolean
            updateMemoryCache?: boolean
            isComplete?: boolean
            startTimeSec?: number
            endTimeSec?: number
          },
        ) => Promise<import('./waveform-cache').CachedWaveform>
      }
    ).generateWaveformWithWorker('media-partial-worker', 'blob:unused', requestId, undefined, {
      persistBins: false,
      persistOPFS: false,
      updateMemoryCache: true,
      isComplete: true,
      startTimeSec: 1,
      endTimeSec: 3,
    })
    await vi.waitFor(() => workerMessageHandler !== null)
    dispatchPartialWorkerResult(requestId)

    const waveform = await promise
    expect(waveform.isComplete).toBe(false)
    expect(waveform.partial).toBe(true)
    expect(updates.at(-1)?.isComplete).toBe(false)
    expect(updates.at(-1)?.partial).toBe(true)
  })

  it('does not persist partial visible waveform ranges to OPFS', async () => {
    const { waveformCache } = await import('./waveform-cache')
    const promise = waveformCache.prepareVisibleWaveformRange(
      'media-partial-range',
      'blob:unused',
      1,
      3,
      300,
    )
    await vi.waitFor(() => workerMessageHandler !== null)
    dispatchPartialWorkerResult(await waitForWorkerGenerateRequestId())

    const waveform = await promise
    expect(waveform?.partial).toBe(true)
    expect(saveRangeMock).not.toHaveBeenCalled()
  })

  it('attempts AudioContext fallback when the worker reports zero decode', async () => {
    const { waveformCache } = await import('./waveform-cache')
    const service = waveformCache as unknown as {
      generateWaveform: (
        mediaId: string,
        blobUrl: string,
        requestId: string,
      ) => Promise<import('./waveform-cache').CachedWaveform>
      generateWaveformFallback: ReturnType<typeof vi.fn>
      generateWaveformWithWorker: ReturnType<typeof vi.fn>
    }

    const fallbackSpy = vi
      .spyOn(service, 'generateWaveformFallback')
      .mockRejectedValue(new Error('fallback invoked'))
    vi.spyOn(service, 'generateWaveformWithWorker').mockRejectedValue(
      new Error('No audio samples decoded'),
    )

    await expect(
      service.generateWaveform('media-zero-decode', 'blob:unused', 'waveform-cache-zero-decode'),
    ).rejects.toThrow('fallback invoked')
    expect(fallbackSpy).toHaveBeenCalledTimes(1)

    fallbackSpy.mockRestore()
  })

  it('end-to-end: zero-decode worker error skips complete cache and uses fallback', async () => {
    const { waveformCache } = await import('./waveform-cache')
    const service = waveformCache as unknown as {
      generateWaveform: (
        mediaId: string,
        blobUrl: string,
        requestId: string,
      ) => Promise<import('./waveform-cache').CachedWaveform>
      generateWaveformFallback: (
        mediaId: string,
        blobUrl: string,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal,
      ) => Promise<import('./waveform-cache').CachedWaveform>
    }

    const fallbackSpy = vi
      .spyOn(service, 'generateWaveformFallback')
      .mockRejectedValue(new Error('fallback invoked'))

    const mediaId = 'media-zero-decode-e2e'
    const requestId = 'waveform-cache-zero-decode-e2e'
    const promise = service.generateWaveform(mediaId, 'blob:unused', requestId)
    await vi.waitFor(() => workerMessageHandler !== null)

    workerMessageHandler?.({
      data: {
        type: 'init',
        requestId,
        duration: 3,
        channels: 1,
        stereo: false,
        sampleRate: 500,
        totalSamples: 1500,
      },
    } as MessageEvent)
    workerMessageHandler?.({
      data: {
        type: 'error',
        requestId,
        error: 'No audio samples decoded',
      },
    } as MessageEvent)

    await expect(promise).rejects.toThrow('fallback invoked')
    expect(fallbackSpy).toHaveBeenCalledTimes(1)
    const cached = waveformCache.getFromMemoryCacheSync(mediaId)
    expect(cached?.isComplete).not.toBe(true)

    fallbackSpy.mockRestore()
  })
})
