import type { VideoItem } from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { buildMediaTimelineItem, createClassicTrack } from '@/features/editor/deps/timeline-utils'
import { useProjectStore } from '@/features/editor/deps/projects'
import { useSelectionStore } from '@/shared/state/selection'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'

/**
 * Add generated video to a fresh video track at the requested playhead frame.
 */
export function insertGeneratedVideoOnNewTrack(
  media: MediaMetadata,
  blobUrl: string,
  playheadFrame: number,
): boolean {
  const { tracks, fps, addItemOnNewTrack, addItemWithLinkedAudio } = useTimelineStore.getState()
  const from = Number.isFinite(playheadFrame) ? Math.max(0, Math.round(playheadFrame)) : 0
  const durationInFrames = Math.max(1, Math.round(media.duration * fps))
  const maxOrder = tracks.reduce((max, track) => Math.max(max, track.order), 0)
  const newTrack = createClassicTrack({ tracks, kind: 'video', order: maxOrder + 1 })

  const currentProject = useProjectStore.getState().currentProject
  const canvasWidth = currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH
  const canvasHeight = currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT

  const item = buildMediaTimelineItem({
    media: {
      duration: media.duration,
      fps: media.fps,
      width: media.width,
      height: media.height,
    },
    mediaId: media.id,
    mediaType: 'video',
    label: media.fileName,
    projectFps: fps,
    blobUrl,
    thumbnailUrl: media.thumbnailId ? undefined : null,
    canvasWidth,
    canvasHeight,
    placement: { trackId: newTrack.id, from, durationInFrames },
    originId: crypto.randomUUID(),
  }) as VideoItem

  if (media.audioCodec) {
    addItemWithLinkedAudio(item)
  } else {
    addItemOnNewTrack(item, [...tracks, newTrack])
  }

  const added = useTimelineStore.getState().items.some((timelineItem) => timelineItem.id === item.id)
  if (added) {
    useSelectionStore.getState().selectItems([item.id])
  }
  return added
}
