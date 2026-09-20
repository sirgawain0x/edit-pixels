import type { MediaMetadata } from '@/types/storage'
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import { createClassicTrack } from '@/features/editor/deps/timeline-utils'
import { computeFitScaleTransform } from '@/shared/utils/fit-scale-transform'
import { useProjectStore } from '@/features/editor/deps/projects'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { resolveMediaUrl, useMediaLibraryStore } from '@/features/editor/deps/media-library'
import { buildDirectorTimelineAudioContext } from '../director/timeline-audio'
import type { DirectorStoryboardShotPayload } from './seedance-client'
import type { DirectorBatchShotJob } from './director-batch-queue'
import {
  computeDirectorBatchPlacements,
  resolveDirectorBatchTimingMode,
  type DirectorShotPlacement,
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

function shotTimingInputs(
  shots: readonly DirectorStoryboardShotPayload[],
): DirectorShotTimingInput[] {
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

function buildDirectorBatchVideoItem(
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
    transform: computeFitScaleTransform(sourceWidth, sourceHeight, canvasWidth, canvasHeight),
  }
}

export function collectSucceededBatchJobs(
  shots: readonly DirectorStoryboardShotPayload[],
  jobs: readonly DirectorBatchShotJob[],
): DirectorBatchShotJob[] {
  return shots
    .map((shot) => jobs.find((job) => job.shotId === shot.shotId && job.status === 'succeeded'))
    .filter((job): job is DirectorBatchShotJob => job !== undefined)
}

export function getDirectorBatchAudioContextOrError(
  items: Parameters<typeof buildDirectorTimelineAudioContext>[0],
  fps: number,
):
  | { ok: true; audioContext: ReturnType<typeof buildDirectorTimelineAudioContext> }
  | PlaceDirectorBatchResult {
  const audioContext = buildDirectorTimelineAudioContext(items, fps)
  if (!audioContext.hasAudio || !audioContext.primary) {
    return {
      ok: false,
      reason: 'no_audio',
      message: 'Place audio on the timeline first — batch clips align to the master audio track.',
    }
  }
  return { ok: true, audioContext }
}

export function computeBatchShotPlacements(
  shots: readonly DirectorStoryboardShotPayload[],
  audioContext: ReturnType<typeof buildDirectorTimelineAudioContext>,
): DirectorShotPlacement[] {
  const primary = audioContext.primary!
  return computeDirectorBatchPlacements({
    shots: shotTimingInputs(shots),
    audioDurationSeconds: primary.durationSeconds,
    audioStartFrame: primary.fromFrame,
    fps: audioContext.fps,
  })
}

/** User-facing warning when storyboard timecodes cannot be used (equal-split fallback). */
export function getDirectorBatchTimingPlacementWarning(
  shots: readonly DirectorStoryboardShotPayload[],
): string | null {
  const inputs = shotTimingInputs(shots)
  const mode = resolveDirectorBatchTimingMode(inputs)
  if (mode.mode === 'storyboard') return null

  if (mode.fallbackReason === 'inverted') {
    return 'Storyboard timecodes were invalid (end before start) — clips were equal-split across audio instead.'
  }

  const hasPartialFields = inputs.some(
    (shot) =>
      shot.startSeconds !== undefined ||
      shot.endSeconds !== undefined ||
      shot.durationSeconds !== undefined,
  )
  if (hasPartialFields) {
    return 'Storyboard timecodes were incomplete — clips were equal-split across audio instead.'
  }

  return null
}

export type ResolvedDirectorBatchVideoItems =
  | { ready: true; videoItems: VideoItem[]; newTrack: TimelineTrack }
  | PlaceDirectorBatchResult

export async function resolveDirectorBatchVideoItems(input: {
  succeededJobs: readonly DirectorBatchShotJob[]
  placements: readonly DirectorShotPlacement[]
  tracks: TimelineTrack[]
  fps: number
}): Promise<ResolvedDirectorBatchVideoItems> {
  const { succeededJobs, placements, tracks, fps } = input
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
      buildDirectorBatchVideoItem(
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

  return { ready: true, videoItems, newTrack }
}

export function applyDirectorBatchCrossfades(
  videoItems: VideoItem[],
  useCrossfade: boolean,
  addTransition: (
    leftClipId: string,
    rightClipId: string,
    type: 'crossfade',
    durationInFrames: number,
  ) => boolean,
): void {
  if (!useCrossfade || videoItems.length <= 1) return

  for (let index = 0; index < videoItems.length - 1; index += 1) {
    const left = videoItems[index]!
    const right = videoItems[index + 1]!
    const leftEnd = left.from + left.durationInFrames
    if (leftEnd === right.from) {
      addTransition(left.id, right.id, 'crossfade', LIGHT_CROSSFADE_FRAMES)
    }
  }
}
