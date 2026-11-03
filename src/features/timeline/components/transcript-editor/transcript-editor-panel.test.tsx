import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { useClipboardStore } from '@/shared/state/clipboard'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { useItemsStore } from '../../stores/items-store'
import { useTransitionsStore } from '../../stores/transitions-store'
import { useKeyframesStore } from '../../stores/keyframes-store'
import { useTimelineSettingsStore } from '../../stores/timeline-settings-store'
import { useTimelineCommandStore } from '../../stores/timeline-command-store'
import { useTranscriptIgnoreStore } from '../../stores/transcript-ignore-store'
import { TranscriptEditorPanel } from './transcript-editor-panel'

const mocks = vi.hoisted(() => ({
  getTranscript: vi.fn(),
  run: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }))
vi.mock('sonner', () => ({
  toast: { success: mocks.success, warning: mocks.warning, error: vi.fn(), info: vi.fn() },
}))
vi.mock('../../deps/media-transcription-service', () => ({
  mediaTranscriptionService: {
    getTranscript: mocks.getTranscript,
    syncExistingTranscriptCaptions: vi.fn(),
    onTranscriptChanged: () => () => {},
  },
  runMediaTranscriptionJob: mocks.run,
  cancelMediaTranscriptionJob: vi.fn(),
}))
vi.mock('../../deps/transcribe-dialog', () => ({ TranscribeDialog: () => null }))

const clip: VideoItem = {
  id: 'clip',
  type: 'video',
  mediaId: 'm',
  trackId: 'track',
  from: 0,
  durationInFrames: 300,
  sourceStart: 0,
  sourceEnd: 300,
  sourceDuration: 300,
  sourceFps: 30,
  src: 'blob:video',
  label: 'clip',
  originId: 'origin',
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  useItemsStore.getState().setItems([clip])
  useItemsStore.getState().setTracks([])
  useSelectionStore.getState().selectItems(['clip'])
  usePlaybackStore.setState({ currentFrame: 0, isPlaying: false })
  useEditorStore.setState({ linkedSelectionEnabled: true })
  useTimelineSettingsStore.setState({ fps: 30 })
  useTransitionsStore.getState().setTransitions([])
  useKeyframesStore.getState().setKeyframes([])
  useTimelineCommandStore.getState().clearHistory()
  useTranscriptIgnoreStore.getState().clear()
  mocks.getTranscript.mockResolvedValue({
    id: 'm',
    mediaId: 'm',
    updatedAt: 2,
    createdAt: 1,
    model: 'parakeet-tdt-v3',
    quantization: 'hybrid',
    text: 'wrong after',
    segments: [
      {
        start: 2,
        end: 5,
        text: 'wrong after',
        words: [
          { text: 'wrong', start: 2, end: 3 },
          { text: 'after', start: 4, end: 5 },
        ],
      },
    ],
  })
})
afterEach(cleanup)

describe('TranscriptEditorPanel', () => {
  it('marks, commits, removes words from the document, and undoes the actual timeline cut', async () => {
    render(<TranscriptEditorPanel active />)
    fireEvent.pointerDown(await screen.findByText('wrong'), { pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Mark for delete' }))
    expect(useItemsStore.getState().items).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Delete marked' }))
    await waitFor(() => expect(screen.queryByText('wrong')).toBeNull())
    expect(screen.getByText('after')).toBeTruthy()
    expect(useTranscriptIgnoreStore.getState().ranges).toEqual({})
    expect(
      useItemsStore.getState().items.reduce((sum, item) => sum + item.durationInFrames, 0),
    ).toBe(270)
    useTimelineCommandStore.getState().undo()
    await screen.findByText('wrong')
    expect(useItemsStore.getState().items).toHaveLength(1)
  })

  it('cuts selected word media and keeps surviving transcript pieces selected', async () => {
    render(<TranscriptEditorPanel active />)
    fireEvent.pointerDown(await screen.findByText('wrong'), { pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }))
    await waitFor(() => expect(screen.queryByText('wrong')).toBeNull())
    expect(screen.getByText('after')).toBeTruthy()
    const clipboard = useClipboardStore.getState().itemsClipboard
    expect(clipboard?.copyType).toBe('cut')
    expect(clipboard?.items[0]).toMatchObject({
      sourceStart: 60,
      sourceEnd: 90,
      durationInFrames: 30,
    })
    expect(useSelectionStore.getState().selectedItemIds).toHaveLength(2)
  })

  it('explains transition-blocked deletes and keeps their marks', async () => {
    useTransitionsStore.getState().setTransitions([
      {
        id: 'transition',
        leftClipId: 'clip',
        rightClipId: 'other',
        trackId: 'track',
        type: 'crossfade',
        presentation: 'fade',
        timing: 'linear',
        durationInFrames: 12,
        alignment: 0.5,
      },
    ])
    mocks.getTranscript.mockResolvedValueOnce({
      id: 'm',
      mediaId: 'm',
      updatedAt: 2,
      segments: [
        {
          start: 9.85,
          end: 9.95,
          text: 'blocked',
          words: [{ text: 'blocked', start: 9.85, end: 9.95 }],
        },
      ],
    })
    render(<TranscriptEditorPanel active />)
    fireEvent.pointerDown(await screen.findByText('blocked'), { pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Mark for delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete marked' }))
    expect(screen.getByText(/Move or remove the transition/)).toBeTruthy()
    expect(useTranscriptIgnoreStore.getState().ranges.m).toHaveLength(1)
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('does not claim a blocked cut succeeded and keeps the failed range marked', async () => {
    useTransitionsStore.getState().setTransitions([
      {
        id: 'transition',
        leftClipId: 'clip',
        rightClipId: 'other',
        trackId: 'track',
        type: 'crossfade',
        presentation: 'fade',
        timing: 'linear',
        durationInFrames: 12,
        alignment: 0.5,
      },
    ])
    mocks.getTranscript.mockResolvedValueOnce({
      id: 'm',
      mediaId: 'm',
      updatedAt: 2,
      segments: [
        {
          start: 9.85,
          end: 9.95,
          text: 'blocked',
          words: [{ text: 'blocked', start: 9.85, end: 9.95 }],
        },
      ],
    })
    render(<TranscriptEditorPanel active />)
    fireEvent.pointerDown(await screen.findByText('blocked'), { pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }))
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.warning).toHaveBeenCalled()
    expect(screen.getByText('blocked')).toBeTruthy()
    expect(useTranscriptIgnoreStore.getState().ranges.m).toHaveLength(1)
    expect(screen.getByText(/Move or remove the transition/)).toBeTruthy()
  })

  it('opens word correction on double click', async () => {
    render(<TranscriptEditorPanel active />)
    fireEvent.doubleClick(await screen.findByText('wrong'))
    expect(
      (screen.getByRole('textbox', { name: 'Corrected words' }) as HTMLInputElement).value,
    ).toBe('wrong')
  })
})
