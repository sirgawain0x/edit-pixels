// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { AudioItem, VideoItem } from '@/types/timeline'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { useKeyframesStore } from '../keyframes-store'
import { useItemsStore } from '../items-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useTransitionsStore } from '../transitions-store'
import {
  removeTranscriptRangesFromItems,
  type TranscriptRemovalResult,
} from './edit/range-removal-actions'

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

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'audio-track',
    from: 0,
    durationInFrames: 300,
    label: 'clip.mp4',
    src: 'blob:audio',
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

function sourceSpans(type: 'audio' | 'video') {
  return useItemsStore
    .getState()
    .items.filter((item) => item.type === type)
    .toSorted((left, right) => left.from - right.from)
    .map((item) => ({
      from: item.from,
      durationInFrames: item.durationInFrames,
      sourceStart: item.sourceStart,
      sourceEnd: item.sourceEnd,
    }))
}

/**
 * The invariant that makes a partial delete visible: every committed range is
 * either landed or skipped, never both, never neither.
 */
function expectPartitionOfCommittedRanges(
  result: TranscriptRemovalResult,
  committedRangeCount: number,
): void {
  const landedCount = Object.values(result.landedRangesByMediaId).reduce(
    (sum, ranges) => sum + ranges.length,
    0,
  )
  expect(landedCount + result.skipped.length).toBe(committedRangeCount)
  expect(result.removedRangeCount).toBe(landedCount)
}

describe('removeTranscriptRangesFromItems', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useEditorStore.setState({ linkedSelectionEnabled: true })
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
    useSelectionStore.getState().clearSelection()
  })

  it('lands a clean word range and reports it as landed', () => {
    useItemsStore.getState().setItems([makeVideoItem()])

    const result = removeTranscriptRangesFromItems(['video-1'], {
      'media-1': [{ start: 2, end: 4 }],
    })

    expectPartitionOfCommittedRanges(result, 1)
    expect(result.skipped).toEqual([])
    expect(result.landedRangesByMediaId).toEqual({ 'media-1': [{ start: 2, end: 4 }] })
    expect(result.removedItemCount).toBeGreaterThan(0)
    expect(sourceSpans('video')).toEqual([
      { from: 0, durationInFrames: 60, sourceStart: 0, sourceEnd: 60 },
      { from: 60, durationInFrames: 180, sourceStart: 120, sourceEnd: 300 },
    ])
  })

  it('reports transition-overlap instead of silently removing nothing', () => {
    useItemsStore.getState().setItems([makeVideoItem()])
    attachRightEdgeTransition('video-1')

    const result = removeTranscriptRangesFromItems(['video-1'], {
      'media-1': [{ start: 9.85, end: 9.95 }],
    })

    expectPartitionOfCommittedRanges(result, 1)
    expect(result.removedItemCount).toBe(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ mediaId: 'media-1', reason: 'transition-overlap' })
    expect(sourceSpans('video')).toEqual([
      { from: 0, durationInFrames: 300, sourceStart: 0, sourceEnd: 300 },
    ])
  })

  it('lands the good range and skips only the blocked one, so the delete is partial', () => {
    useItemsStore.getState().setItems([makeVideoItem()])
    attachRightEdgeTransition('video-1')

    const result = removeTranscriptRangesFromItems(['video-1'], {
      'media-1': [
        { start: 2, end: 4 },
        { start: 9.85, end: 9.95 },
      ],
    })

    expectPartitionOfCommittedRanges(result, 2)
    expect(result.landedRangesByMediaId).toEqual({ 'media-1': [{ start: 2, end: 4 }] })
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ reason: 'transition-overlap' })
  })

  it('reports clip-edge when the range lies outside the clip source window', () => {
    useItemsStore.getState().setItems([makeVideoItem()])

    const result = removeTranscriptRangesFromItems(['video-1'], {
      'media-1': [{ start: 12, end: 14 }],
    })

    expectPartitionOfCommittedRanges(result, 1)
    expect(result.removedItemCount).toBe(0)
    expect(result.skipped[0]).toMatchObject({ reason: 'clip-edge' })
  })

  it('removes a short word rounded to timeline frames and supports undo', () => {
    useItemsStore.getState().setItems([makeVideoItem()])
    const range = { start: 2.014, end: 2.052 }
    const result = removeTranscriptRangesFromItems(['video-1'], { 'media-1': [range] })
    expect(result.removedItemCount).toBe(1)
    expect(result.skipped).toEqual([])
    expectPartitionOfCommittedRanges(result, 1)
    useTimelineCommandStore.getState().undo()
    expect(sourceSpans('video')).toEqual([
      { from: 0, durationInFrames: 300, sourceStart: 0, sourceEnd: 300 },
    ])
  })

  it('lands a range that covers the whole clip by removing the clip', () => {
    useItemsStore.getState().setItems([makeVideoItem()])

    const result = removeTranscriptRangesFromItems(['video-1'], {
      'media-1': [{ start: 0, end: 10 }],
    })

    expectPartitionOfCommittedRanges(result, 1)
    expect(result.landedRangesByMediaId).toEqual({ 'media-1': [{ start: 0, end: 10 }] })
    expect(useItemsStore.getState().items).toHaveLength(0)
  })

  it('lands a range on a reversed clip', () => {
    useItemsStore.getState().setItems([makeVideoItem({ isReversed: true })])

    const result = removeTranscriptRangesFromItems(['video-1'], {
      'media-1': [{ start: 2, end: 4 }],
    })

    expectPartitionOfCommittedRanges(result, 1)
    expect(result.skipped).toEqual([])
    expect(sourceSpans('video')).toEqual([
      { from: 0, durationInFrames: 180, sourceStart: 120, sourceEnd: 300 },
      { from: 180, durationInFrames: 60, sourceStart: 0, sourceEnd: 60 },
    ])
  })

  it('lands linked video + audio as one range, not two', () => {
    useItemsStore
      .getState()
      .setItems([
        makeVideoItem({ linkedGroupId: 'group-1' }),
        makeAudioItem({ linkedGroupId: 'group-1' }),
      ])

    const result = removeTranscriptRangesFromItems(['video-1', 'audio-1'], {
      'media-1': [{ start: 2, end: 4 }],
    })

    expectPartitionOfCommittedRanges(result, 1)
    expect(result.skipped).toEqual([])
    expect(result.removedItemCount).toBe(2)
    expect(sourceSpans('video')).toHaveLength(2)
    expect(sourceSpans('audio')).toHaveLength(2)
  })

  it('reports no-timeline-clip when the committed media has no clip on the timeline', () => {
    useItemsStore.getState().setItems([makeVideoItem()])

    const result = removeTranscriptRangesFromItems(['video-1'], {
      'media-missing': [{ start: 1, end: 2 }],
    })

    expectPartitionOfCommittedRanges(result, 1)
    expect(result.removedItemCount).toBe(0)
    expect(result.skipped[0]).toMatchObject({
      mediaId: 'media-missing',
      reason: 'no-timeline-clip',
    })
  })

  it('partitions every committed range when nothing is on the timeline at all', () => {
    const result = removeTranscriptRangesFromItems([], {
      'media-1': [
        { start: 1, end: 2 },
        { start: 3, end: 4 },
      ],
    })

    expectPartitionOfCommittedRanges(result, 2)
    expect(result.skipped.every((entry) => entry.reason === 'no-timeline-clip')).toBe(true)
  })
})
