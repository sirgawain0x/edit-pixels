// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { useKeyframesStore } from './keyframes-store'
import { useItemsStore } from './items-store'
import { useTimelineCommandStore } from './timeline-command-store'
import { useTimelineSettingsStore } from './timeline-settings-store'
import { useTransitionsStore } from './transitions-store'
import { useTranscriptIgnoreStore } from './transcript-ignore-store'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'video-track',
    from: 0,
    durationInFrames: 300,
    label: 'clip.mp4',
    src: 'blob:video',
    mediaId: 'media-1',
    originId: 'origin-1',
    sourceStart: 0,
    sourceEnd: 300,
    sourceDuration: 300,
    sourceFps: 30,
    ...overrides,
  }
}

/** A transition on the clip's right edge: frames >= duration - 6 are unsplittable. */
function attachRightEdgeTransition(clipId: string): void {
  useTransitionsStore.getState().setTransitions([
    {
      id: 'transition-1',
      leftClipId: clipId,
      rightClipId: 'video-other',
      trackId: 'video-track',
      type: 'crossfade',
      durationInFrames: 12,
      presentation: 'fade',
      timing: 'linear',
      alignment: 0.5,
    },
  ])
}

describe('useTranscriptIgnoreStore.commit', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useEditorStore.setState({ linkedSelectionEnabled: true })
    useItemsStore.getState().setItems([makeVideoItem()])
    useItemsStore.getState().setTracks([])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
    useSelectionStore.getState().clearSelection()
    useTranscriptIgnoreStore.getState().clear()
  })

  it('clears only the ranges that landed', () => {
    attachRightEdgeTransition('video-1')
    useTranscriptIgnoreStore.getState().ignore({
      'media-1': [
        { start: 2, end: 4 },
        { start: 9.85, end: 9.95 },
      ],
    })

    const result = useTranscriptIgnoreStore.getState().commit()

    expect(result?.skipped).toHaveLength(1)
    expect(result?.landedRangesByMediaId).toEqual({ 'media-1': [{ start: 2, end: 4 }] })
    // The blocked range is still staged, so it is still struck and retryable.
    expect(useTranscriptIgnoreStore.getState().ranges).toEqual({
      'media-1': [{ start: 9.85, end: 9.95 }],
    })
  })

  it('keeps the entire review state when nothing could be removed', () => {
    attachRightEdgeTransition('video-1')
    useTranscriptIgnoreStore.getState().ignore({ 'media-1': [{ start: 9.85, end: 9.95 }] })

    const result = useTranscriptIgnoreStore.getState().commit()

    expect(result?.removedItemCount).toBe(0)
    expect(result?.skipped).toHaveLength(1)
    expect(useTranscriptIgnoreStore.getState().ranges).toEqual({
      'media-1': [{ start: 9.85, end: 9.95 }],
    })
  })

  it('keeps staged words when their timeline clip has disappeared', () => {
    const ranges = { 'media-1': [{ start: 2, end: 4 }] }
    useTranscriptIgnoreStore.getState().ignore(ranges)
    useItemsStore.getState().setItems([])
    const result = useTranscriptIgnoreStore.getState().commit()
    expect(result?.skipped[0]?.reason).toBe('no-timeline-clip')
    expect(useTranscriptIgnoreStore.getState().ranges).toEqual(ranges)
  })

  it('empties the buffer when every range landed', () => {
    useTranscriptIgnoreStore.getState().ignore({ 'media-1': [{ start: 2, end: 4 }] })

    const result = useTranscriptIgnoreStore.getState().commit()

    expect(result?.skipped).toEqual([])
    expect(useTranscriptIgnoreStore.getState().ranges).toEqual({})
  })
})
