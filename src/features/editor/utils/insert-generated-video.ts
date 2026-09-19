import type { VideoItem } from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { computeFitScaleTransform, createClassicTrack } from '@/features/editor/deps/timeline-utils'
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
  const sourceFps = media.fps || fps
  const durationInFrames = Math.max(1, Math.round(media.duration * fps))
  const sourceDuration = Math.max(1, Math.round(media.duration * sourceFps))
  const sourceEnd = Math.min(
    sourceDuration,
    Math.round((durationInFrames * sourceFps) / fps),
  )
  const maxOrder = tracks.reduce((max, track) => Math.max(max, track.order), 0)
  const newTrack = createClassicTrack({ tracks, kind: 'video', order: maxOrder + 1 })

  const currentProject = useProjectStore.getState().currentProject
  const canvasWidth = currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH
  const canvasHeight = currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT
  const sourceWidth = media.width || canvasWidth
  const sourceHeight = media.height || canvasHeight

  const item: VideoItem = {
    id: crypto.randomUUID(),
    type: 'video',
    trackId: newTrack.id,
    from,
    durationInFrames,
    label: media.fileName,
    mediaId: media.id,
    originId: crypto.randomUUID(),
    src: blobUrl,
    sourceStart: 0,
    sourceEnd,
    sourceDuration,
    sourceFps,
    trimStart: 0,
    trimEnd: 0,
    sourceWidth: media.width || undefined,
    sourceHeight: media.height || undefined,
    transform: computeFitScaleTransform(sourceWidth, sourceHeight, canvasWidth, canvasHeight),
  }

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
