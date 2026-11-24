import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { VideoContent } from './video-content'

/**
 * A clip that failed once must be able to recover.
 *
 * The resolver republishes a blob URL after a stale one fails (`invalidate` → re-resolve), and
 * the failure state used to outlive that: the component only cleared it when the *media id*
 * changed, so a clip sat on "Media unavailable" while holding a perfectly good new URL. The
 * only escape was a remount — which is why leaving and reopening the project "fixed" it.
 */

const testState = vi.hoisted(() => ({
  preloadSourceMock: vi.fn(() => Promise.resolve()),
  acquireForClipMock: vi.fn(),
  releaseClipMock: vi.fn(),
  pool: null as {
    preloadSource: ReturnType<typeof vi.fn>
    acquireForClip: ReturnType<typeof vi.fn>
    releaseClip: ReturnType<typeof vi.fn>
  } | null,
  playbackState: { currentFrame: 0, isPlaying: false, previewFrame: null, volume: 1, muted: false },
  gizmoState: { activeGizmo: null, preview: null },
  timelineState: { keyframes: [] as unknown[] },
  mediaById: {} as Record<string, unknown>,
}))

testState.pool = {
  preloadSource: testState.preloadSourceMock,
  acquireForClip: testState.acquireForClipMock,
  releaseClip: testState.releaseClipMock,
}

const { acquireForClipMock } = testState

function createStoreHook<TState extends object>(state: TState) {
  const hook = ((selector?: (value: TState) => unknown) =>
    selector ? selector(state) : state) as ((selector?: (value: TState) => unknown) => unknown) & {
    getState: () => TState
  }
  hook.getState = () => state
  return hook
}

function createMockVideoElement(): HTMLVideoElement {
  const element = document.createElement('video')
  Object.defineProperty(element, 'readyState', { configurable: true, get: () => 4 })
  Object.defineProperty(element, 'videoWidth', { configurable: true, get: () => 1920 })
  Object.defineProperty(element, 'videoHeight', { configurable: true, get: () => 1080 })
  Object.defineProperty(element, 'duration', { configurable: true, get: () => 120 })
  Object.defineProperty(element, 'currentTime', {
    configurable: true,
    get: () => 0,
    set: () => {},
  })
  Object.defineProperty(element, 'paused', { configurable: true, get: () => true })
  // jsdom has no media error object; the component reads it to build the message.
  Object.defineProperty(element, 'error', {
    configurable: true,
    get: () => ({ message: 'Format error' }),
  })

  element.play = vi.fn(async () => {})
  element.pause = vi.fn()
  return element
}

vi.mock('@/runtime/composition-runtime/deps/player', () => ({
  useSequenceContext: () => ({ localFrame: 0, from: 0, durationInFrames: 120, parentFrom: 0 }),
  useVideoSourcePool: () => testState.pool!,
  useClock: () => ({ currentFrame: 0, onFrameChange: () => () => {} }),
  useClockPlaybackRate: () => 1,
  interpolate: () => 0,
  isVideoPoolAbortError: () => false,
}))

vi.mock('@/runtime/composition-runtime/deps/stores', () => ({
  usePlaybackStore: createStoreHook(testState.playbackState),
  useGizmoStore: createStoreHook(testState.gizmoState),
  useTimelineStore: createStoreHook(testState.timelineState),
  useMediaLibraryStore: (() => {
    const state = { mediaById: testState.mediaById, brokenMediaIds: [] }
    const hook = (selector?: (value: typeof state) => unknown) =>
      selector ? selector(state) : state
    hook.getState = () => state
    return hook
  })(),
}))

vi.mock('../hooks/use-player-compat', () => ({
  useVideoConfig: () => ({ fps: 30, width: 1280, height: 720, durationInFrames: 120 }),
  useIsPlaying: () => testState.playbackState.isPlaying,
}))

vi.mock('../contexts/keyframes-context', () => ({
  useItemKeyframesFromContext: () => null,
}))

vi.mock('@/runtime/composition-runtime/deps/keyframes', () => ({
  getPropertyKeyframes: () => [],
  interpolatePropertyValue: (_keyframes: unknown, _frame: number, fallback: number) => fallback,
}))

vi.mock('@/runtime/composition-runtime/utils/dom-video-element-registry', () => ({
  registerDomVideoElement: vi.fn(),
  unregisterDomVideoElement: vi.fn(),
}))

vi.mock('./video-audio-context', () => ({
  applyVideoElementAudioState: vi.fn(),
  useVideoAudioState: vi.fn(() => ({ audioVolume: 1, resolvedAudioEqStages: [] })),
  connectedVideoElements: new WeakSet<HTMLVideoElement>(),
  videoAudioContexts: new WeakMap<HTMLVideoElement, AudioContext>(),
  ensureAudioContextResumed: vi.fn(),
}))

// The live-decode canvas is the fallback the component drops into after a failed retry, so its
// presence is a stable way to observe "this clip gave up on its source".
vi.mock('./prores-preview-canvas', () => ({
  ProResPreviewCanvas: () => <div data-testid="live-decode" />,
}))

function clip(src: string) {
  return (
    <VideoContent
      item={{
        id: 'clip-a',
        type: 'video',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 90,
        label: 'Clip A',
        src,
        mediaId: 'media-1',
        _poolClipId: 'group-origin-1',
      }}
      muted={false}
      safeTrimBefore={0}
      playbackRate={1}
      sourceFps={30}
      audioEqStages={[]}
    />
  )
}

/** Fail the element the way a stale blob URL does: retry once, live-decode, then give up. */
async function failMedia(element: HTMLVideoElement) {
  await act(async () => {
    element.dispatchEvent(new Event('error'))
    await Promise.resolve()
  })
  await act(async () => {
    element.dispatchEvent(new Event('error'))
    await Promise.resolve()
  })
}

describe('VideoContent recovery', () => {
  beforeEach(() => {
    testState.acquireForClipMock.mockReset()
    testState.mediaById = {}
    // The pooled path only mounts while playing, matching the existing suite's setup.
    testState.playbackState.isPlaying = true
  })

  it('returns to the element path when the resolver republishes a working URL', async () => {
    const element = createMockVideoElement()
    acquireForClipMock.mockReturnValue(element)

    const { rerender } = render(clip('blob:stale'))

    await failMedia(element)
    // The retry was spent on the stale URL, so the clip fell back to live decode.
    expect(screen.getByTestId('live-decode')).toBeInTheDocument()

    // Same media, fresh URL: a re-resolve succeeded, so the clip gets a normal element again
    // instead of staying on the fallback forever.
    rerender(clip('blob:fresh'))

    await waitFor(() => {
      expect(screen.queryByTestId('live-decode')).not.toBeInTheDocument()
    })
  })

  it('does not re-arm the retry loop when the same failing URL is handed down again', async () => {
    const element = createMockVideoElement()
    acquireForClipMock.mockReturnValue(element)

    const { rerender } = render(clip('blob:stale'))

    await failMedia(element)
    expect(screen.getByTestId('live-decode')).toBeInTheDocument()

    rerender(clip('blob:stale'))

    // The source did not change, so the fallback stands: no endless error → retry churn.
    expect(screen.getByTestId('live-decode')).toBeInTheDocument()
  })

  it('stops refreshing once a refreshed URL also fails, instead of looping forever', async () => {
    const element = createMockVideoElement()
    acquireForClipMock.mockReturnValue(element)
    const invalidateSpy = vi.spyOn(blobUrlManager, 'invalidate')

    const { rerender } = render(clip('blob:a'))

    // First failure: one refresh is allowed.
    await act(async () => {
      element.dispatchEvent(new Event('error'))
      await Promise.resolve()
    })
    expect(invalidateSpy).toHaveBeenCalledTimes(1)

    // The resolver hands down a fresh URL, which also fails. Without a per-clip budget this
    // invalidated again and the cycle never ended — every lap re-reading the file.
    rerender(clip('blob:b'))
    await act(async () => {
      element.dispatchEvent(new Event('error'))
      await Promise.resolve()
    })

    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    // Budget spent, so the clip falls back rather than refreshing a third time.
    await waitFor(() => {
      expect(screen.getByTestId('live-decode')).toBeInTheDocument()
    })
  })

  it('gives a different clip a fresh refresh budget', async () => {
    const element = createMockVideoElement()
    acquireForClipMock.mockReturnValue(element)
    const invalidateSpy = vi.spyOn(blobUrlManager, 'invalidate')

    const { rerender } = render(clip('blob:a'))
    await act(async () => {
      element.dispatchEvent(new Event('error'))
      await Promise.resolve()
    })
    expect(invalidateSpy).toHaveBeenCalledTimes(1)

    // A pooled handoff to another clip is a different media, so it may refresh once too.
    rerender(
      <VideoContent
        item={{
          id: 'clip-b',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'Clip B',
          src: 'blob:other',
          mediaId: 'media-2',
          _poolClipId: 'group-origin-1',
        }}
        muted={false}
        safeTrimBefore={0}
        playbackRate={1}
        sourceFps={30}
        audioEqStages={[]}
      />,
    )

    await act(async () => {
      element.dispatchEvent(new Event('error'))
      await Promise.resolve()
    })
    expect(invalidateSpy).toHaveBeenCalledTimes(2)
  })
})
