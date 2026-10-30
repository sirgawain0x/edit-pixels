import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ImageItem } from '@/types/timeline'
import { useTransitionDragStore } from '@/shared/state/transition-drag'
import { resolveTransitionWindows } from '@/shared/timeline/transitions/transition-planner'
import { useItemsStore } from '../../stores/items-store'
import { useTransitionsStore } from '../../stores/transitions-store'
import { useTimelineStore } from '../../stores/timeline-store'
import { useTimelineItemDropHandlers } from './use-timeline-item-drop-handlers'

const leftClip: ImageItem = {
  id: 'left',
  type: 'image',
  trackId: 'track',
  from: 0,
  durationInFrames: 120,
  src: 'blob:left',
  label: 'Left',
}
const rightClip: ImageItem = {
  ...leftClip,
  id: 'right',
  from: 120,
  src: 'blob:right',
  label: 'Right',
}

function dragEvent(clientX: number): React.DragEvent<HTMLDivElement> {
  return {
    clientX,
    clientY: 0,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 30 }) },
    dataTransfer: { dropEffect: 'none' },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.DragEvent<HTMLDivElement>
}

describe('transition cut drops', () => {
  beforeEach(() => {
    useItemsStore.setState({ items: [leftClip, rightClip] })
    useTransitionsStore.setState({ transitions: [] })
    useTransitionDragStore.getState().setDraggedTransition({ presentation: 'fade' })
  })

  afterEach(() => {
    useTransitionDragStore.getState().clearDrag()
    useItemsStore.setState({ items: [] })
    useTransitionsStore.setState({ transitions: [] })
    vi.restoreAllMocks()
  })

  for (const edge of ['left', 'right'] as const) {
    for (const clientX of [1, 15, 29]) {
      it(`centers preview and drop at ${clientX}px on the ${edge} cut target`, () => {
        const addTransition = vi
          .spyOn(useTimelineStore.getState(), 'addTransition')
          .mockReturnValue(true)
        const { result } = renderHook(() =>
          useTimelineItemDropHandlers({
            item: edge === 'left' ? rightClip : leftClip,
            trackLocked: false,
            addEffects: vi.fn(),
          }),
        )

        result.current.handleTransitionCutDragOver(edge)(dragEvent(clientX))
        const preview = useTransitionDragStore.getState().preview!
        expect(preview).toMatchObject({ leftClipId: 'left', rightClipId: 'right', alignment: 0.5 })
        const [window] = resolveTransitionWindows(
          [
            {
              id: 'transition',
              type: 'crossfade',
              presentation: 'fade',
              timing: 'linear',
              trackId: 'track',
              ...preview,
            },
          ],
          new Map([
            [leftClip.id, leftClip],
            [rightClip.id, rightClip],
          ]),
        )
        expect(window!.startFrame).toBeLessThan(rightClip.from)
        expect(window!.endFrame).toBeGreaterThan(rightClip.from)

        result.current.handleTransitionCutDrop(edge)(dragEvent(clientX))
        expect(addTransition).toHaveBeenCalledWith(
          'left',
          'right',
          'crossfade',
          preview.durationInFrames,
          'fade',
          undefined,
          0.5,
        )
      })
    }
  }
})
