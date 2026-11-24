import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { resolveTransitionWindows } from '@/shared/timeline/transitions/transition-planner'
import { getTransitionBridgeBounds } from './transition-preview-geometry'

/**
 * The orange bridge on the timeline has to be the same length as the cross-fade that renders.
 *
 * When a clip carries two transitions, the planner scales both down
 * (`solveClipTransitionPressure`) so they fit the clip. The bridge used to be drawn from the
 * requested duration instead, so two neighbouring bridges overlapped each other and each was
 * wider than the fade it stood for: dragging one open moved a rectangle the renderer never
 * followed.
 */

function clip(id: string, from: number, durationInFrames: number): TimelineItem {
  return {
    id,
    trackId: 'track-1',
    type: 'video',
    src: `blob:${id}`,
    mediaId: `media-${id}`,
    label: id,
    from,
    durationInFrames,
    sourceStart: 0,
    sourceEnd: durationInFrames,
    sourceDuration: durationInFrames * 4,
    sourceFps: 30,
    trimStart: 0,
    trimEnd: 0,
    transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 },
  } as unknown as TimelineItem
}

function crossfade(id: string, leftId: string, rightId: string, durationInFrames: number) {
  return {
    id,
    type: 'crossfade',
    leftClipId: leftId,
    rightClipId: rightId,
    trackId: 'track-1',
    durationInFrames,
    alignment: 0.5,
  } as unknown as Transition
}

/** Two 30-frame crossfades around a 20-frame clip: 15 + 15 frames wanted, 20 available. */
function pressuredTimeline() {
  const clips = [clip('a', 0, 120), clip('b', 120, 20), clip('c', 140, 120)]
  const clipsById = new Map(clips.map((entry) => [entry.id, entry]))
  const transitions = [crossfade('t1', 'a', 'b', 30), crossfade('t2', 'b', 'c', 30)]
  const windows = resolveTransitionWindows(transitions, clipsById)
  return { clips, transitions, windows }
}

describe('transition bridge under clip pressure', () => {
  it('draws the pressured window, not the requested duration', () => {
    const { windows } = pressuredTimeline()

    for (const window of windows) {
      const bridge = getTransitionBridgeBounds(
        window.leftClip.from,
        window.leftClip.durationInFrames,
        window.rightClip.from,
        window.transition.durationInFrames,
        window.transition.alignment,
        { leftPortion: window.leftPortion, rightPortion: window.rightPortion },
      )

      expect(bridge.leftFrame).toBe(window.startFrame)
      expect(bridge.rightFrame).toBe(window.endFrame)
    }
  })

  it('no longer overlaps the neighbouring bridge', () => {
    const { windows } = pressuredTimeline()
    const bounds = windows.map((window) =>
      getTransitionBridgeBounds(
        window.leftClip.from,
        window.leftClip.durationInFrames,
        window.rightClip.from,
        window.transition.durationInFrames,
        window.transition.alignment,
        { leftPortion: window.leftPortion, rightPortion: window.rightPortion },
      ),
    )

    const [first, second] = bounds
    // They meet at the cut; neither covers the other's frames.
    expect(first!.rightFrame).toBe(second!.leftFrame)
  })

  it('would overstate the fade by the unreserved amount without the planner portions', () => {
    // Regression guard for the reason the portions are passed at all: the requested 30 frames
    // is 5 frames wider than the 25 the renderer uses, and the two bridges overlap by 10.
    const { clips, transitions, windows } = pressuredTimeline()
    const requestedBounds = transitions.map((transition) =>
      getTransitionBridgeBounds(
        clips.find((entry) => entry.id === transition.leftClipId)!.from,
        clips.find((entry) => entry.id === transition.leftClipId)!.durationInFrames,
        clips.find((entry) => entry.id === transition.rightClipId)!.from,
        transition.durationInFrames,
        transition.alignment,
      ),
    )

    const first = windows.find((window) => window.transition.id === 't1')!
    expect(first.durationInFrames).toBe(25)
    expect(requestedBounds[0]).toEqual({ leftFrame: 105, rightFrame: 135 })
    expect(requestedBounds[1]).toEqual({ leftFrame: 125, rightFrame: 155 })
    // 135 > 125: the two rectangles the user sees overlap, the fades do not.
    expect(requestedBounds[0]!.rightFrame).toBeGreaterThan(requestedBounds[1]!.leftFrame)
  })
})
