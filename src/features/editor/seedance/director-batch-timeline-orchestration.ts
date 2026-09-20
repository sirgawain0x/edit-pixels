import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import {
  clearDirectorBatchPlacementPayload,
  loadDirectorBatchJob,
  loadDirectorBatchPlacementPayload,
  markDirectorBatchAutoLaid,
  type DirectorBatchActiveJob,
} from './director-batch-job-store'
import type { DirectorBatchShotJob } from './director-batch-queue'
import { countBatchProgress } from './director-batch-queue'
import type { DirectorBatchRunnerPhase } from './director-batch-runner'
import type { DirectorStoryboardShotPayload } from './seedance-client'
import { getDirectorBatchTimingPlacementWarning } from './place-director-batch-on-timeline-helpers'
import { placeDirectorBatchOnTimeline } from './place-director-batch-on-timeline'

export interface DirectorBatchPanelSessionState {
  activeJob: DirectorBatchActiveJob | null
  jobs: DirectorBatchShotJob[]
  phase: DirectorBatchRunnerPhase | 'quoting' | 'idle'
  timelinePlaced: boolean
  clearQuote: boolean
  clearStalePlacementPayload: boolean
}

export function resolveDirectorBatchPanelSession(shotsKey: string): DirectorBatchPanelSessionState {
  const saved = loadDirectorBatchJob()
  const savedShotIds = saved?.jobs.map((job) => job.shotId).join(',') ?? ''
  if (saved && savedShotIds === shotsKey) {
    const hasRunning = saved.jobs.some(
      (job) => job.status === 'queued' || job.status === 'running',
    )
    const hasFailed = saved.jobs.some((job) => job.status === 'failed')
    return {
      activeJob: saved,
      jobs: saved.jobs,
      phase: hasRunning ? 'running' : hasFailed ? 'done' : 'idle',
      timelinePlaced: false,
      clearQuote: false,
      clearStalePlacementPayload: false,
    }
  }

  const placementPayload = loadDirectorBatchPlacementPayload()
  if (placementPayload && placementPayload.shotsKey === shotsKey) {
    return {
      activeJob: null,
      jobs: placementPayload.jobs,
      phase: 'done',
      timelinePlaced: placementPayload.autoLaid,
      clearQuote: false,
      clearStalePlacementPayload: false,
    }
  }

  return {
    activeJob: null,
    jobs: [],
    phase: 'idle',
    timelinePlaced: false,
    clearQuote: true,
    clearStalePlacementPayload: Boolean(placementPayload),
  }
}

export async function runGuardedDirectorBatchPlacement(input: {
  shots: readonly DirectorStoryboardShotPayload[]
  jobList: DirectorBatchShotJob[]
  useCrossfade: boolean
  placingRef: { current: boolean }
  isReLay?: boolean
  t: TFunction
}): Promise<boolean> {
  const { shots, jobList, useCrossfade, placingRef, isReLay, t } = input
  if (placingRef.current) return false
  placingRef.current = true

  try {
    const timingWarning = getDirectorBatchTimingPlacementWarning(shots)
    if (timingWarning) {
      toast.warning(timingWarning)
    }

    if (isReLay) {
      toast.info(
        t('director.batch.reLayCrossfade', {
          defaultValue: useCrossfade
            ? 'Re-laying with light crossfade between cuts.'
            : 'Re-laying with hard cuts (crossfade off).',
        }),
      )
    }

    const result = await placeDirectorBatchOnTimeline({
      shots,
      jobs: jobList,
      useCrossfade,
    })
    if (!result.ok) {
      toast.error(result.message)
      return false
    }

    toast.success(
      t('director.batch.timelinePlaced', {
        defaultValue: '{{count}} clips laid on the timeline.',
        count: result.placedCount,
      }),
    )
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Timeline placement failed'
    toast.error(message)
    return false
  } finally {
    placingRef.current = false
  }
}

export async function maybeAutoLayDirectorBatch(input: {
  layOnTimeline: boolean
  hasAudio: boolean
  resultJobs: DirectorBatchShotJob[]
  runPlacement: (jobList: DirectorBatchShotJob[]) => Promise<boolean>
  t: TFunction
}): Promise<void> {
  const { layOnTimeline, hasAudio, resultJobs, runPlacement, t } = input
  const final = countBatchProgress(resultJobs)
  if (final.failed > 0) {
    toast.warning(
      t('director.batch.partial', {
        defaultValue: '{{succeeded}} succeeded, {{failed}} failed — retry failed shots.',
        succeeded: final.succeeded,
        failed: final.failed,
      }),
    )
    return
  }

  toast.success(
    t('director.batch.success', {
      defaultValue: '{{count}} shots imported to media library.',
      count: final.succeeded,
    }),
  )

  if (!layOnTimeline) return

  const placementPayload = loadDirectorBatchPlacementPayload()
  if (placementPayload?.autoLaid) return

  if (!hasAudio) {
    toast.warning(
      t('director.batch.noAudioForTimeline', {
        defaultValue:
          'Clips imported — place audio on the timeline, then use Lay on timeline.',
      }),
    )
    return
  }

  const placed = await runPlacement(resultJobs)
  if (placed) {
    markDirectorBatchAutoLaid()
  }
}

export function resetDirectorBatchPlacementSession(): void {
  clearDirectorBatchPlacementPayload()
}
