import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { CompositionInputProps } from '@/types/export'

class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return {} as unknown
  }
}
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  ;(globalThis as unknown as { OffscreenCanvas: typeof FakeOffscreenCanvas }).OffscreenCanvas =
    FakeOffscreenCanvas
}

const playbackState = vi.hoisted(() => ({
  zoom: -1,
  useProxy: true,
}))
const signatureState = vi.hoisted(() => ({ value: 'composition-graph-0', counter: 0 }))

const compositionState = vi.hoisted(() => {
  const composition = {
    id: 'composition-1',
    name: 'Compound 1',
    fps: 30,
    width: 1280,
    height: 720,
    durationInFrames: 90,
    items: [],
    tracks: [],
    transitions: [],
    keyframes: [],
    backgroundColor: '#000000',
  }

  return {
    composition,
    compositionById: {
      'composition-1': composition,
    } as Record<string, typeof composition | undefined>,
  }
})

const buildSubCompositionInputMock = vi.hoisted(() => vi.fn())
const buildSubCompositionPreviewSignatureMock = vi.hoisted(() => vi.fn())
const resolveMediaUrlsMock = vi.hoisted(() => vi.fn())
const createCompositionRendererMock = vi.hoisted(() => vi.fn())
let clearDisplayCanvasMock: ReturnType<typeof vi.fn>
let drawDisplayCanvasMock: ReturnType<typeof vi.fn>

vi.mock('@/shared/state/playback', () => {
  const usePlaybackStore = Object.assign(
    (selector: (state: typeof playbackState) => unknown) => selector(playbackState),
    { getState: () => playbackState },
  )

  return { usePlaybackStore }
})

vi.mock('@/features/preview/deps/timeline-contract', () => {
  const useCompositionsStore = Object.assign(
    (selector: (state: typeof compositionState) => unknown) => selector(compositionState),
    { getState: () => compositionState },
  )

  return {
    useCompositionsStore,
    buildSubCompositionInput: buildSubCompositionInputMock,
    buildSubCompositionPreviewSignature: buildSubCompositionPreviewSignatureMock,
  }
})

vi.mock('@/features/preview/deps/media-library-contract', () => ({
  resolveMediaUrls: resolveMediaUrlsMock,
}))

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  useBlobUrlVersion: () => 0,
}))

vi.mock('@/features/preview/deps/export', () => ({
  importCompositionRenderer: vi.fn(async () => ({
    createCompositionRenderer: createCompositionRendererMock,
  })),
}))

import { InlineCompositionPreview } from './inline-composition-preview'
import { disposeComparisonCompositionRenderSessionsForTest } from './comparison-composition-render-session'

describe('InlineCompositionPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDisplayCanvasMock = vi.fn()
    drawDisplayCanvasMock = vi.fn()
    const canvasPrototype = HTMLCanvasElement.prototype as unknown as {
      getContext: () => CanvasRenderingContext2D
    }
    vi.spyOn(canvasPrototype, 'getContext').mockReturnValue({
      clearRect: clearDisplayCanvasMock,
      drawImage: drawDisplayCanvasMock,
    } as unknown as CanvasRenderingContext2D)
    signatureState.counter += 1
    signatureState.value = `composition-graph-${signatureState.counter}`
    playbackState.zoom = -1
    playbackState.useProxy = true

    const inputProps: CompositionInputProps = {
      fps: 30,
      durationInFrames: 90,
      width: 1280,
      height: 720,
      tracks: [
        {
          id: 'track-1',
          name: 'V1',
          kind: 'video',
          height: 60,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items: [],
        },
      ],
      transitions: [],
      keyframes: [],
      backgroundColor: '#000000',
    }

    const resolvedTracks = inputProps.tracks.map((track) => ({ ...track, resolved: true }))

    buildSubCompositionInputMock.mockReturnValue(inputProps)
    buildSubCompositionPreviewSignatureMock.mockImplementation(() => signatureState.value)
    resolveMediaUrlsMock.mockResolvedValue(resolvedTracks)
    createCompositionRendererMock.mockResolvedValue({
      preload: vi.fn().mockResolvedValue(undefined),
      renderFrame: vi.fn().mockResolvedValue(undefined),
      warmGpuPipeline: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    })
  })

  afterEach(() => {
    disposeComparisonCompositionRenderSessionsForTest()
    vi.restoreAllMocks()
  })

  it('asks again for an asset that resolved empty, instead of keeping the blank', async () => {
    const partialTracks = [
      {
        id: 'track-1',
        type: 'video',
        items: [
          {
            id: 'item-1',
            type: 'video',
            mediaId: 'media-2',
            src: '',
            startFrame: 0,
            durationInFrames: 30,
          },
        ],
      },
    ]
    const completeTracks = [
      {
        id: 'track-1',
        type: 'video',
        items: [
          {
            id: 'item-1',
            type: 'video',
            mediaId: 'media-2',
            src: 'blob:recovered',
            startFrame: 0,
            durationInFrames: 30,
          },
        ],
      },
    ]

    resolveMediaUrlsMock
      .mockImplementationOnce(
        async (_tracks: unknown, options: { onItemFailure?: (id: string) => void }) => {
          // What the real resolver does when the bytes are not readable at that instant.
          options.onItemFailure?.('media-2')
          return partialTracks
        },
      )
      .mockResolvedValue(completeTracks)

    render(
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={12}
        containerSize={{ width: 800, height: 600 }}
      />,
    )

    await waitFor(() => {
      expect(resolveMediaUrlsMock).toHaveBeenCalledTimes(1)
    })

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })

    // The result was incomplete, so it was not cached: becoming visible again re-resolves.
    // Dispatched in a loop because the listener only exists once React has committed the
    // partial result, which is an async render behind the awaited promise.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }

    await waitFor(() => {
      expect(resolveMediaUrlsMock).toHaveBeenCalledTimes(2)
    })
    // The second answer was complete, so it was cached and nothing retried a third time.
    expect(resolveMediaUrlsMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache a partial result whose effect was cancelled mid-flight', async () => {
    const partialTracks = [
      {
        id: 'track-1',
        type: 'video',
        items: [
          {
            id: 'item-1',
            type: 'video',
            mediaId: 'media-3',
            src: '',
            startFrame: 0,
            durationInFrames: 30,
          },
        ],
      },
    ]
    const completeTracks = [
      {
        id: 'track-1',
        type: 'video',
        items: [
          {
            id: 'item-1',
            type: 'video',
            mediaId: 'media-3',
            src: 'blob:recovered',
            startFrame: 0,
            durationInFrames: 30,
          },
        ],
      },
    ]

    let releaseFirst: () => void = () => {}
    const firstRun = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    resolveMediaUrlsMock
      .mockImplementationOnce(
        async (_tracks: unknown, options: { onItemFailure?: (id: string) => void }) => {
          await firstRun
          options.onItemFailure?.('media-3')
          return partialTracks
        },
      )
      .mockResolvedValue(completeTracks)

    const first = render(
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={12}
        containerSize={{ width: 800, height: 600 }}
      />,
    )

    await waitFor(() => {
      expect(resolveMediaUrlsMock).toHaveBeenCalledTimes(1)
    })

    // The sheet closes before the assets land, so the effect is cancelled mid-flight. The
    // partial result must still be evicted, or every later attempt is served the same blanks.
    first.unmount()
    await act(async () => {
      releaseFirst()
      await firstRun
    })

    render(
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={12}
        containerSize={{ width: 800, height: 600 }}
      />,
    )

    await waitFor(() => {
      expect(resolveMediaUrlsMock).toHaveBeenCalledTimes(2)
    })
  })

  it('stops retrying once a missing asset is clearly missing', async () => {
    resolveMediaUrlsMock.mockImplementation(
      async (_tracks: unknown, options: { onItemFailure?: (id: string) => void }) => {
        options.onItemFailure?.('media-gone')
        return [
          {
            id: 'track-1',
            type: 'video',
            items: [{ id: 'item-1', type: 'video', mediaId: 'media-gone', src: '' }],
          },
        ]
      },
    )

    render(
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={12}
        containerSize={{ width: 800, height: 600 }}
      />,
    )

    await waitFor(() => {
      expect(resolveMediaUrlsMock).toHaveBeenCalledTimes(1)
    })

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }

    // Three retries, then the broken-media UI takes over instead of hammering storage forever.
    expect(resolveMediaUrlsMock).toHaveBeenCalledTimes(4)
  })

  it('resolves compound clip tracks with proxy playback when enabled', async () => {
    render(
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={12}
        containerSize={{ width: 800, height: 600 }}
      />,
    )

    await waitFor(() => {
      expect(resolveMediaUrlsMock).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ useProxy: true, onItemFailure: expect.any(Function) }),
      )
    })

    await waitFor(() => {
      expect(createCompositionRendererMock).toHaveBeenCalled()
    })

    const [compositionInput] = createCompositionRendererMock.mock.calls[0] ?? []
    expect(compositionInput.tracks[0]).toMatchObject({ resolved: true })
  })

  it('renders a clamped nested composition frame without workspace chrome', async () => {
    render(
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={120}
        containerSize={{ width: 320, height: 180 }}
        presentation="frame"
      />,
    )

    expect(screen.getByLabelText('Compound clip frame preview')).toBeTruthy()
    expect(screen.queryByLabelText('Inline compound clip preview')).toBeNull()

    await waitFor(() => {
      const renderer = createCompositionRendererMock.mock.results[0]?.value
      expect(renderer).toBeTruthy()
    })

    const renderer = await createCompositionRendererMock.mock.results[0]?.value
    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(89)
    })
    expect(createCompositionRendererMock.mock.calls[0]?.[3]).toMatchObject({
      mode: 'comparison',
      useProxyMedia: true,
    })
    expect(renderer.preload.mock.calls[0]?.[0]).toMatchObject({
      priorityFrame: 89,
      signal: expect.any(AbortSignal),
    })
  })

  it('shares one comparison renderer across sibling frame panels', async () => {
    render(
      <>
        <InlineCompositionPreview
          compositionId="composition-1"
          seekFrame={12}
          containerSize={{ width: 320, height: 180 }}
          presentation="frame"
        />
        <InlineCompositionPreview
          compositionId="composition-1"
          seekFrame={24}
          containerSize={{ width: 320, height: 180 }}
          presentation="frame"
        />
      </>,
    )

    await waitFor(() => expect(createCompositionRendererMock).toHaveBeenCalledTimes(1))
    const renderer = await createCompositionRendererMock.mock.results[0]?.value
    await waitFor(() => {
      expect(renderer.renderFrame).toHaveBeenCalledWith(12)
      expect(renderer.renderFrame).toHaveBeenCalledWith(24)
    })
    expect(renderer.preload.mock.calls[0]?.[0]).toMatchObject({
      priorityFrame: 12,
      priorityFrames: [12, 24],
    })
    expect(resolveMediaUrlsMock).not.toHaveBeenCalled()
  })

  it('retains a comparison renderer across a quick overlay remount', async () => {
    const first = render(
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={12}
        containerSize={{ width: 320, height: 180 }}
        presentation="frame"
      />,
    )

    await waitFor(() => expect(createCompositionRendererMock).toHaveBeenCalledTimes(1))
    const renderer = await createCompositionRendererMock.mock.results[0]?.value
    await waitFor(() => expect(renderer.renderFrame).toHaveBeenCalledWith(12))
    first.unmount()

    render(
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={24}
        containerSize={{ width: 320, height: 180 }}
        presentation="frame"
      />,
    )

    await waitFor(() => expect(renderer.renderFrame).toHaveBeenCalledWith(24))
    expect(createCompositionRendererMock).toHaveBeenCalledTimes(1)
    expect(renderer.dispose).not.toHaveBeenCalled()
  })

  it('reuses the active comparison session while drag frames change', async () => {
    const { rerender } = render(
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={12}
        containerSize={{ width: 320, height: 180 }}
        presentation="frame"
      />,
    )

    await waitFor(() => expect(createCompositionRendererMock).toHaveBeenCalledTimes(1))
    const renderer = await createCompositionRendererMock.mock.results[0]?.value
    await waitFor(() => expect(renderer.renderFrame).toHaveBeenCalledWith(12))

    rerender(
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={13}
        containerSize={{ width: 320, height: 180 }}
        presentation="frame"
      />,
    )

    await waitFor(() => expect(renderer.renderFrame).toHaveBeenCalledWith(13))
    expect(createCompositionRendererMock).toHaveBeenCalledTimes(1)
    expect(renderer.preload).toHaveBeenCalledTimes(1)
    expect(renderer.dispose).not.toHaveBeenCalled()
  })

  it('presents an in-flight frame and coalesces continuous drag updates', async () => {
    const pendingRenders: Array<{ frame: number; resolve: () => void }> = []
    const renderer = {
      preload: vi.fn().mockResolvedValue(undefined),
      renderFrame: vi.fn(
        (renderFrame: number) =>
          new Promise<void>((resolve) => {
            pendingRenders.push({ frame: renderFrame, resolve })
          }),
      ),
      warmGpuPipeline: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    }
    createCompositionRendererMock.mockResolvedValue(renderer)

    const renderFramePreview = (seekFrame: number) => (
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={seekFrame}
        containerSize={{ width: 320, height: 180 }}
        presentation="frame"
      />
    )
    const { rerender } = render(renderFramePreview(12))

    await waitFor(() => expect(renderer.renderFrame).toHaveBeenCalledWith(12))
    await waitFor(() => expect(screen.getByText('Loading compound clip...')).toBeTruthy())

    rerender(renderFramePreview(13))
    rerender(renderFramePreview(14))
    rerender(renderFramePreview(15))

    expect(renderer.renderFrame).toHaveBeenCalledTimes(1)

    await act(async () => {
      const firstRender = pendingRenders[0]
      if (!firstRender) throw new Error('Expected the initial comparison frame render')
      firstRender.resolve()
      await Promise.resolve()
    })

    await waitFor(() => expect(drawDisplayCanvasMock).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByText('Loading compound clip...')).toBeNull())
    await waitFor(() => expect(renderer.renderFrame).toHaveBeenCalledTimes(2))
    expect(pendingRenders.map(({ frame }) => frame)).toEqual([12, 15])

    await act(async () => {
      const latestRender = pendingRenders[1]
      if (!latestRender) throw new Error('Expected the latest comparison frame render')
      latestRender.resolve()
      await Promise.resolve()
    })
    await waitFor(() => expect(drawDisplayCanvasMock).toHaveBeenCalledTimes(2))
  })

  it('renders priority video-only frames before background preload completes', async () => {
    let finishPreload!: () => void
    const preloadPending = new Promise<void>((resolve) => {
      finishPreload = resolve
    })
    const renderer = {
      preload: vi.fn(async (options: { onPriorityMediaReady?: () => void }) => {
        options.onPriorityMediaReady?.()
        await preloadPending
      }),
      renderFrame: vi.fn().mockResolvedValue(undefined),
      warmGpuPipeline: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    }
    createCompositionRendererMock.mockResolvedValue(renderer)

    render(
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={12}
        containerSize={{ width: 320, height: 180 }}
        presentation="frame"
      />,
    )

    await waitFor(() => expect(renderer.renderFrame).toHaveBeenCalledWith(12))
    expect(renderer.preload).toHaveBeenCalled()
    finishPreload()
  })

  it('rebuilds the renderer when a nested composition graph revision changes', async () => {
    const view = (
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={12}
        containerSize={{ width: 320, height: 180 }}
        presentation="frame"
      />
    )
    const { rerender } = render(view)

    await waitFor(() => expect(createCompositionRendererMock).toHaveBeenCalledTimes(1))
    const firstRenderer = await createCompositionRendererMock.mock.results[0]?.value
    const firstPreloadSignal = firstRenderer.preload.mock.calls[0]?.[0]?.signal as AbortSignal

    signatureState.value = `${signatureState.value}:nested-edit`
    rerender(
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={12}
        containerSize={{ width: 321, height: 180 }}
        presentation="frame"
      />,
    )

    await waitFor(() => expect(createCompositionRendererMock).toHaveBeenCalledTimes(2))
    expect(firstRenderer.dispose).toHaveBeenCalledOnce()
    expect(firstPreloadSignal.aborted).toBe(true)
  })
})
