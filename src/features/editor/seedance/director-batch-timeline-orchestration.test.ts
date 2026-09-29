import type { TFunction } from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runGuardedDirectorBatchPlacement } from './director-batch-timeline-orchestration'
import type { DirectorBatchShotJob } from './director-batch-queue'

vi.mock('./place-director-batch-on-timeline', () => ({
  placeDirectorBatchOnTimeline: vi.fn(async () => ({
    ok: true,
    placedCount: 2,
    clipIds: ['clip-1', 'clip-2'],
  })),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

const { placeDirectorBatchOnTimeline } = await import('./place-director-batch-on-timeline')
const { toast } = await import('sonner')

const shots = [
  { shotId: 'shot-1', prompt: 'A' },
  { shotId: 'shot-2', prompt: 'B' },
]

const jobs: DirectorBatchShotJob[] = [
  {
    shotId: 'shot-1',
    requestId: 'req-1',
    provider: 'veo',
    status: 'succeeded',
    progress: 100,
    generateEndpoint: '/api/pixels-render-veo',
  },
  {
    shotId: 'shot-2',
    requestId: 'req-2',
    provider: 'veo',
    status: 'succeeded',
    progress: 100,
    generateEndpoint: '/api/pixels-render-veo',
  },
]

const t = ((key: string, opts?: { defaultValue?: string }) =>
  opts?.defaultValue ?? key) as TFunction

describe('runGuardedDirectorBatchPlacement', () => {
  beforeEach(() => {
    vi.mocked(placeDirectorBatchOnTimeline).mockClear()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.info).mockClear()
  })

  it('blocks concurrent placement while placingRef is held', async () => {
    const placingRef = { current: true }
    const placed = await runGuardedDirectorBatchPlacement({
      shots,
      jobList: jobs,
      useCrossfade: false,
      placingRef,
      t,
    })
    expect(placed).toBe(false)
    expect(placeDirectorBatchOnTimeline).not.toHaveBeenCalled()
  })

  it('places clips and clears placingRef after success', async () => {
    const placingRef = { current: false }
    const placed = await runGuardedDirectorBatchPlacement({
      shots,
      jobList: jobs,
      useCrossfade: true,
      placingRef,
      isReLay: true,
      t,
    })
    expect(placed).toBe(true)
    expect(placeDirectorBatchOnTimeline).toHaveBeenCalledWith({
      shots,
      jobs,
      useCrossfade: true,
    })
    expect(placingRef.current).toBe(false)
    expect(toast.info).toHaveBeenCalled()
  })
})
