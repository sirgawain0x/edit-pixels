import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import type { DirectorStoryboardShotPayload } from './seedance-client'
import type { DirectorBatchShotJob } from './director-batch-queue'
import {
  applyDirectorBatchCrossfades,
  collectSucceededBatchJobs,
  computeBatchShotPlacements,
  getDirectorBatchAudioContextOrError,
  resolveDirectorBatchVideoItems,
  type PlaceDirectorBatchResult,
} from './place-director-batch-on-timeline-helpers'

export type { PlaceDirectorBatchResult }

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

  const audioResult = getDirectorBatchAudioContextOrError(items, fps)
  if (!('audioContext' in audioResult)) {
    return audioResult
  }

  const succeededJobs = collectSucceededBatchJobs(shots, jobs)
  if (succeededJobs.length === 0) {
    return {
      ok: false,
      reason: 'no_succeeded_shots',
      message: 'No completed shots to place on the timeline.',
    }
  }

  const placements = computeBatchShotPlacements(shots, audioResult.audioContext)
  const resolved = await resolveDirectorBatchVideoItems({
    succeededJobs,
    placements,
    tracks,
    fps,
  })
  if (!('ready' in resolved)) {
    return resolved
  }

  const { videoItems, newTrack } = resolved
  addItemsOnNewTracks(videoItems, [...tracks, newTrack])
  applyDirectorBatchCrossfades(videoItems, useCrossfade, addTransition)
  useSelectionStore.getState().selectItems(videoItems.map((item) => item.id))

  return {
    ok: true,
    placedCount: videoItems.length,
    clipIds: videoItems.map((item) => item.id),
  }
}
