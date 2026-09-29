import { describe, expect, it } from 'vitest'
import type { DirectorBatchShotJob } from './director-batch-queue'
import {
  collectSucceededBatchJobs,
  getDirectorBatchTimingPlacementWarning,
} from './place-director-batch-on-timeline-helpers'
import type { DirectorStoryboardShotPayload } from './seedance-client'

const shots: DirectorStoryboardShotPayload[] = [
  { shotId: 'shot-1', prompt: 'A', startSeconds: 0, endSeconds: 10 },
  { shotId: 'shot-2', prompt: 'B', startSeconds: 10, endSeconds: 20 },
]

function job(shotId: string, status: DirectorBatchShotJob['status']): DirectorBatchShotJob {
  return {
    shotId,
    requestId: `req-${shotId}`,
    provider: 'veo',
    status,
    progress: status === 'succeeded' ? 100 : 0,
    generateEndpoint: '/api/pixels-render-veo',
  }
}

describe('place-director-batch-on-timeline helpers', () => {
  it('collectSucceededBatchJobs preserves storyboard order and skips failures', () => {
    const jobs = [job('shot-1', 'succeeded'), job('shot-2', 'failed')]
    const succeeded = collectSucceededBatchJobs(shots, jobs)
    expect(succeeded.map((entry) => entry.shotId)).toEqual(['shot-1'])
  })

  it('warns when inverted storyboard timings force equal-split fallback', () => {
    const inverted: DirectorStoryboardShotPayload[] = [
      { shotId: 'shot-1', prompt: 'A', startSeconds: 12, endSeconds: 4 },
      { shotId: 'shot-2', prompt: 'B', startSeconds: 0, endSeconds: 10 },
    ]
    expect(getDirectorBatchTimingPlacementWarning(inverted)).toContain('invalid')
  })

  it('warns when storyboard timings are incomplete', () => {
    const partial: DirectorStoryboardShotPayload[] = [
      { shotId: 'shot-1', prompt: 'A', startSeconds: 0, endSeconds: 10 },
      { shotId: 'shot-2', prompt: 'B' },
    ]
    expect(getDirectorBatchTimingPlacementWarning(partial)).toContain('incomplete')
  })

  it('returns no warning for valid storyboard timings', () => {
    expect(getDirectorBatchTimingPlacementWarning(shots)).toBeNull()
  })
})
