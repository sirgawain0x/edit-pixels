import type { MediaMetadata } from '@/types/storage'
import type { VideoItem } from '@/types/timeline'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { createClassicTrack } from '@/features/editor/deps/timeline-utils'
import { useProjectStore } from '@/features/editor/deps/projects'
import { useSelectionStore } from '@/shared/state/selection'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { useMediaLibraryStore, resolveMediaUrl } from '@/features/editor/deps/media-library'
import { buildDirectorTimelineAudioContext } from '../director/timeline-audio'
import type { DirectorStoryboardShotPayload } from './seedance-client'
import type { DirectorBatchShotJob } from './director-batch-queue'
import {
  computeDirectorBatchPlacements,
  type DirectorShotTimingInput,
} from './director-batch-timeline-timing'

const LIGHT_CROSSFADE_FRAMES = 6

export type PlaceDirectorBatchFailureReason =
  | 'no_audio'
  | 'no_succeeded_shots'
  | 'missing_media'

export type PlaceDirectorBatchResult =
  | { ok: true; placedCount: number; clipIds: string[] }
  | { ok: false; reason: PlaceDirectorBatchFailureReason; message: string }

function computeFitTransform(
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const scaleX = canvasWidth / sourceWidth
  const scaleY = canvasHeight / sourceHeight
  const fitScale = Math.min(scaleX, scaleY)
  return {
    x: 0,
    y: 0,
    width: Math.round(sourceWidth * fitScale),
    height: Math.round(sourceHeight * fitScale),
    rotation: 0,
  }
}

function shotTimingInputs(shots: readonly DirectorStoryboardShotPayload[]): DirectorShotTimingInput[] {
  return shots.map((shot) => ({
    shotId: shot.shotId,
    ...(shot.duration !== undefined ? { durationSeconds: shot.duration } : {}),
    ...(shot.startSeconds !== undefined ? { startSeconds: shot.startSeconds } : {}),
    ...(shot.endSeconds !== undefined ? { endSeconds: shot.endSeconds } : {}),
  }))
}

function findMediaForJob(
  job: DirectorBatchShotJob,
  mediaItems: MediaMetadata[],
): MediaMetadata | undefined {
  if (job.mediaId) {
    const byId = mediaItems.find((item) => item.id === job.mediaId)
    if (byId) return byId
  }
  const suffix = `-${job.shotId}-`
  return mediaItems.find(
    (item) =>
      item.fileName.includes(suffix) ||
      item.fileName.includes(`director-batch-${job.shotId}`),
  )
}

function buildVideoItem(
  media: MediaMetadata,
  blobUrl: string,
  trackId: string,
  fromFrame: number,
  durationInFrames: number,
  fps: number,
): VideoItem {
  const sourceFps = media.fps || fps
  const sourceDuration = Math.max(1, Math.round(media.duration * sourceFps))
  const sourceEnd = Math.min(
    sourceDuration,
    Math.round((durationInFrames * sourceFps) / fps),
  )
  const currentProject = useProjectStore.getState().currentProject
  const canvasWidth = currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH
  const canvasHeight = currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT
  const sourceWidth = media.width || canvasWidth
  const sourceHeight = media.height || canvasHeight

  return {
    id: crypto.randomUUID(),
    type: 'video',
    trackId,
    from: fromFrame,
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
    transform: computeFitTransform(sourceWidth, sourceHeight, canvasWidth, canvasHeight),
  }
}

/**
 * Lay succeeded Director batch clips onto a new video track aligned to timeline audio.
 * Never called on generate failure — caller must gate on full batch success.
 */
export async function placeDirectorBatchOnTimeline(input: {
  shots: readonly DirectorStoryboardShotPayload[]
  jobs: readonly DirectorBatchShotJob[]
  useCrossfade?: boolean
}): Promise<PlaceDirectorBatchResult> {
  const { shots, jobs, useCrossfade = false } = input
  const { items, tracks, fps, addItemsOnNewTracks, addTransition } = useTimelineStore.getState()
  const audioContext = buildDirectorTimelineAudioContext(items, fps)

  if (!audioContext.hasAudio || !audioContext.primary) {
    return {
      ok: false,
      reason: 'no_audio',
      message: 'Place audio on the timeline first — batch clips align to the master audio track.',
    }
  }

  const succeededJobs = shots
    .map((shot) => jobs.find((job) => job.shotId === shot.shotId && job.status === 'succeeded'))
    .filter((job): job is DirectorBatchShotJob => job !== undefined)

  if (succeededJobs.length === 0) {
    return {
      ok: false,
      reason: 'no_succeeded_shots',
      message: 'No completed shots to place on the timeline.',
    }
  }

  const placements = computeDirectorBatchPlacements({
    shots: shotTimingInputs(shots),
    audioDurationSeconds: audioContext.primary.durationSeconds,
    audioStartFrame: audioContext.primary.fromFrame,
    fps: audioContext.fps,
  })

  const mediaItems = useMediaLibraryStore.getState().mediaItems
  const placementByShot = new Map(placements.map((placement) => [placement.shotId, placement]))
  const videoItems: VideoItem[] = []
  const maxOrder = tracks.reduce((max, track) => Math.max(max, track.order), 0)
  const newTrack = createClassicTrack({ tracks, kind: 'video', order: maxOrder + 1 })

  for (const job of succeededJobs) {
    const placement = placementByShot.get(job.shotId)
    if (!placement) continue

    const media = findMediaForJob(job, mediaItems)
    if (!media) {
      return {
        ok: false,
        reason: 'missing_media',
        message: `Missing media library entry for ${job.shotId}. Import may still be in progress.`,
      }
    }

    const blobUrl = await resolveMediaUrl(media.id)
    videoItems.push(
      buildVideoItem(
        media,
        blobUrl,
        newTrack.id,
        placement.startFrame,
        placement.durationInFrames,
        fps,
      ),
    )
  }

  if (videoItems.length === 0) {
    return {
      ok: false,
      reason: 'no_succeeded_shots',
      message: 'No clips could be placed on the timeline.',
    }
  }

  addItemsOnNewTracks(videoItems, [...tracks, newTrack])

  if (useCrossfade && videoItems.length > 1) {
    for (let index = 0; index < videoItems.length - 1; index += 1) {
      const left = videoItems[index]!
      const right = videoItems[index + 1]!
      const leftEnd = left.from + left.durationInFrames
      if (leftEnd === right.from) {
        addTransition(left.id, right.id, 'crossfade', LIGHT_CROSSFADE_FRAMES)
      }
    }
  }

  useSelectionStore.getState().selectItems(videoItems.map((item) => item.id))

  return {
    ok: true,
    placedCount: videoItems.length,
    clipIds: videoItems.map((item) => item.id),
  }
}
