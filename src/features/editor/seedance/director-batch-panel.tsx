import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Clapperboard, Film, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useWalletContext } from '@/context/wallet-context'
import { useCredits } from '@/features/editor/deps/credits-contract'
import { useGenerativeAuth } from '@/features/editor/deps/generative'
import { useMediaLibraryStore } from '@/features/editor/deps/media-library'
import { BuyMetokenModal } from '@/features/editor/deps/metoken'
import { getDirectorTreasuryAddress } from '../director/build-director-payment'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import { isSeedanceGenerateEnabled } from '@/config/seedance'
import type { PixelsRenderProvider } from '@/config/pixels-render'
import { cn } from '@/shared/ui/cn'
import type { DirectorStoryboardShotPayload, DirectorBatchQuoteResponse } from './seedance-client'
import { quoteDirectorBatch } from './seedance-client'
import {
  countBatchProgress,
  isBatchQuoteExpired,
  prepareJobsForResume,
  selectShotsForRetry,
  totalCrtvaiForPath,
  type DirectorBatchPath,
  type DirectorBatchShotJob,
} from './director-batch-queue'
import { DIRECTOR_BATCH_SEEDANCE_CONCURRENCY_DEFAULT } from './director-batch-concurrency'
import { loadDirectorBatchJob, type DirectorBatchActiveJob } from './director-batch-job-store'
import {
  maybeAutoLayDirectorBatch,
  resetDirectorBatchPlacementSession,
  resolveDirectorBatchPanelSession,
  runGuardedDirectorBatchPlacement,
} from './director-batch-timeline-orchestration'
import {
  confirmPaidDirectorBatch,
  runDirectorBatchQueue,
  type DirectorBatchRunnerPhase,
} from './director-batch-runner'
import {
  useItemsStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-store-contract'
import { buildDirectorTimelineAudioContext } from '../director/timeline-audio'

const PER_SHOT_OVERRIDE_MAX = 8

interface DirectorBatchPanelProps {
  shots: DirectorStoryboardShotPayload[]
  storyboardId?: string
  disabled?: boolean
}

function pathLabel(path: DirectorBatchPath, t: (key: string, opts?: { defaultValue: string }) => string): string {
  switch (path) {
    case 'allVeo':
      return t('director.batch.pathAllVeo', { defaultValue: 'All Veo' })
    case 'allSeedance':
      return t('director.batch.pathAllSeedance', { defaultValue: 'All Seedance' })
    case 'recommendedMix':
      return t('director.batch.pathRecommended', { defaultValue: 'Recommended mix' })
    default: {
      const _exhaustive: never = path
      return _exhaustive
    }
  }
}

function statusIcon(status: DirectorBatchShotJob['status']) {
  switch (status) {
    case 'succeeded':
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-destructive" />
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    case 'queued':
      return <Clapperboard className="h-3.5 w-3.5 text-muted-foreground" />
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

// fallow-ignore-next-line complexity
export const DirectorBatchPanel = memo(function DirectorBatchPanel({
  shots,
  storyboardId,
  disabled,
}: DirectorBatchPanelProps) {
  const { t } = useTranslation()
  const { connect, authenticated, configured: walletConfigured } = useWalletContext()
  const { balance, refreshBalance } = useCredits()
  const { sendOps, ready: walletOpsReady } = useSmartWalletOps()
  const auth = useGenerativeAuth()
  const currentProjectId = useMediaLibraryStore((s) => s.currentProjectId)
  const canPayOnChain = Boolean(getDirectorTreasuryAddress() && walletOpsReady)

  const [quote, setQuote] = useState<DirectorBatchQuoteResponse | null>(null)
  const [path, setPath] = useState<DirectorBatchPath>('recommendedMix')
  const [perShotOverrides, setPerShotOverrides] = useState<Record<string, PixelsRenderProvider>>({})
  const [phase, setPhase] = useState<DirectorBatchRunnerPhase | 'quoting'>('idle')
  const [jobs, setJobs] = useState<DirectorBatchShotJob[]>([])
  const [activeJob, setActiveJob] = useState<DirectorBatchActiveJob | null>(null)
  const [buyOpen, setBuyOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [layOnTimeline, setLayOnTimeline] = useState(true)
  const [useLightCrossfade, setUseLightCrossfade] = useState(false)
  const [timelinePlaced, setTimelinePlaced] = useState(false)
  const [placingTimeline, setPlacingTimeline] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const resumeAttemptedRef = useRef(false)
  const placingRef = useRef(false)
  const timelineItems = useItemsStore((s) => s.items)
  const timelineFps = useTimelineSettingsStore((s) => s.fps)

  const enabled = isSeedanceGenerateEnabled()
  const busy = phase === 'quoting' || phase === 'confirming' || phase === 'running'
  const showPerShotOverrides = shots.length <= PER_SHOT_OVERRIDE_MAX

  const selectedTotal = useMemo(() => {
    if (!quote) return null
    return totalCrtvaiForPath(quote, path, perShotOverrides)
  }, [quote, path, perShotOverrides])

  const progress = useMemo(() => countBatchProgress(jobs), [jobs])
  const failedJobs = useMemo(() => selectShotsForRetry(jobs), [jobs])
  const insufficient = selectedTotal ? balance < selectedTotal.crtvaiDisplay : false
  const quoteExpired = quote ? isBatchQuoteExpired(quote.expiresAt) : false
  const audioContext = useMemo(
    () => buildDirectorTimelineAudioContext(timelineItems, timelineFps),
    [timelineItems, timelineFps],
  )
  const allSucceeded =
    jobs.length > 0 && progress.succeeded === progress.total && progress.failed === 0
  const canPlaceOnTimeline = allSucceeded && audioContext.hasAudio

  const loadQuote = useCallback(async () => {
    if (!auth || !enabled) return
    setPhase('quoting')
    setError(null)
    try {
      const result = await quoteDirectorBatch(auth, { shots, storyboardId })
      setQuote(result)
      setPhase('idle')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Batch quote failed'
      setError(message)
      setPhase('idle')
    }
  }, [auth, enabled, shots, storyboardId])

  const shotsKey = shots.map((shot) => shot.shotId).join(',')

  useEffect(() => {
    const session = resolveDirectorBatchPanelSession(shotsKey)
    if (session.clearStalePlacementPayload) {
      resetDirectorBatchPlacementSession()
    }
    setActiveJob(session.activeJob)
    setJobs(session.jobs)
    setPhase(session.phase)
    setTimelinePlaced(session.timelinePlaced)
    if (session.clearQuote) {
      setQuote(null)
    }
  }, [shotsKey])

  useEffect(() => {
    if (auth && enabled && !quote && phase === 'idle' && !activeJob) {
      void loadQuote()
    }
  }, [auth, enabled, quote, phase, activeJob, loadQuote])

  const callbacks = useMemo(
    () => ({
      onPhase: setPhase,
      onJobs: setJobs,
      onError: (message: string) => {
        setError(message)
        toast.error(message)
      },
    }),
    [],
  )

  const runTimelinePlacement = useCallback(
    async (jobList: DirectorBatchShotJob[]) => {
      setPlacingTimeline(true)
      setError(null)
      try {
        const placed = await runGuardedDirectorBatchPlacement({
          shots,
          jobList,
          useCrossfade: useLightCrossfade,
          placingRef,
          t,
        })
        if (placed) {
          setTimelinePlaced(true)
        }
        return placed
      } finally {
        setPlacingTimeline(false)
      }
    },
    [shots, useLightCrossfade, t],
  )

  const finishBatchSuccess = useCallback(
    async (resultJobs: DirectorBatchShotJob[]) => {
      await maybeAutoLayDirectorBatch({
        layOnTimeline,
        hasAudio: audioContext.hasAudio,
        resultJobs,
        runPlacement: runTimelinePlacement,
        t,
      })
    },
    [audioContext.hasAudio, layOnTimeline, runTimelinePlacement, t],
  )

  useEffect(() => {
    if (!auth || !currentProjectId || resumeAttemptedRef.current) return
    const saved = loadDirectorBatchJob()
    const savedShotIds = saved?.jobs.map((job) => job.shotId).join(',') ?? ''
    if (!saved || savedShotIds !== shotsKey) return

    const hasInFlight = saved.jobs.some(
      (job) => job.status === 'queued' || job.status === 'running',
    )
    if (!hasInFlight) return

    resumeAttemptedRef.current = true
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const preparedJobs = prepareJobsForResume(saved.jobs)
    const prepared: DirectorBatchActiveJob = { ...saved, jobs: preparedJobs }
    setActiveJob(prepared)
    setJobs(preparedJobs)

    void runDirectorBatchQueue({
      auth,
      active: prepared,
      projectId: currentProjectId,
      callbacks,
      signal: abortRef.current.signal,
    })
      .then(async (result) => {
        setActiveJob(result)
        const final = countBatchProgress(result.jobs)
        if (final.failed === 0 && final.completed === final.total) {
          await finishBatchSuccess(result.jobs)
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Batch resume failed'
        setError(message)
        setPhase('done')
      })
  }, [auth, currentProjectId, shotsKey, callbacks, t])

  // fallow-ignore-next-line complexity
  const handleConfirm = useCallback(async () => {
    if (!auth || !quote || !currentProjectId || busy) return
    if (quoteExpired) {
      void loadQuote()
      return
    }
    if (walletConfigured && !authenticated) {
      connect()
      return
    }
    if (insufficient) {
      setBuyOpen(true)
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setError(null)
    resetDirectorBatchPlacementSession()
    setTimelinePlaced(false)

    try {
      const active = await confirmPaidDirectorBatch({
        auth,
        quote,
        path,
        storyboardId,
        perShotOverrides: Object.keys(perShotOverrides).length > 0 ? perShotOverrides : undefined,
        canPayOnChain,
        sendOps,
        refreshBalance,
        callbacks,
      })
      if (!active) return
      setActiveJob(active)
      const result = await runDirectorBatchQueue({
        auth,
        active,
        projectId: currentProjectId,
        callbacks,
        signal: abortRef.current.signal,
      })
      setActiveJob(result)
      await finishBatchSuccess(result.jobs)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Batch render failed'
      setError(message)
      toast.error(message)
      setPhase(activeJob ? 'done' : 'idle')
    }
  }, [
    auth,
    quote,
    currentProjectId,
    busy,
    walletConfigured,
    authenticated,
    insufficient,
    quoteExpired,
    loadQuote,
    activeJob,
    path,
    storyboardId,
    perShotOverrides,
    canPayOnChain,
    sendOps,
    refreshBalance,
    callbacks,
    connect,
    finishBatchSuccess,
  ])

  const handleRetryFailed = useCallback(async () => {
    if (!auth || !activeJob || !currentProjectId || busy || failedJobs.length === 0) return
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setError(null)
    try {
      const result = await runDirectorBatchQueue({
        auth,
        active: activeJob,
        projectId: currentProjectId,
        retryFailedOnly: true,
        callbacks,
        signal: abortRef.current.signal,
      })
      setActiveJob(result)
      const final = countBatchProgress(result.jobs)
      if (final.failed === 0) {
        await finishBatchSuccess(result.jobs)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retry failed'
      setError(message)
      toast.error(message)
    }
  }, [auth, activeJob, currentProjectId, busy, failedJobs.length, callbacks, finishBatchSuccess])

  const handleLayOnTimeline = useCallback(async () => {
    if (!canPlaceOnTimeline || placingTimeline || placingRef.current) return
    if (timelinePlaced) {
      toast.info(
        t('director.batch.reLayHint', {
          defaultValue: 'Adding another video track with the same clips.',
        }),
      )
    }
    await runTimelinePlacement(jobs)
  }, [canPlaceOnTimeline, placingTimeline, timelinePlaced, runTimelinePlacement, jobs, t])

  if (!enabled) return null

  const paths: DirectorBatchPath[] = ['recommendedMix', 'allVeo', 'allSeedance']

  return (
    <div className="rounded-xl border border-primary/35 bg-secondary/25 p-3.5">
      <p className="font-mono text-[10px] tracking-[0.18em] text-primary/85 uppercase">
        {t('director.batch.eyebrow', { defaultValue: 'Batch render' })}
      </p>
      <h4 className="mt-1 text-[14px] font-semibold tracking-tight text-foreground">
        {t('director.batch.title', {
          defaultValue: 'Render all {{count}} shots',
          count: shots.length,
        })}
      </h4>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {t('director.batch.blurb', {
          defaultValue:
            'One CRTVAI payment for the whole storyboard. After render, clips can auto-lay on the timeline aligned to your audio track. Seedance capped at {{seedanceConcurrency}} concurrent calls; Veo is pay-as-you-go (uncapped).',
          seedanceConcurrency: DIRECTOR_BATCH_SEEDANCE_CONCURRENCY_DEFAULT,
        })}
      </p>

      <div className="mt-3 space-y-2 rounded-lg border border-border/60 bg-background/30 px-3 py-2">
        <label className="flex items-center gap-2 text-[11px] text-foreground">
          <input
            type="checkbox"
            className="rounded border-border"
            checked={layOnTimeline}
            disabled={busy || disabled}
            onChange={(event) => setLayOnTimeline(event.target.checked)}
          />
          {t('director.batch.layOnTimeline', {
            defaultValue: 'Lay on timeline after all shots succeed',
          })}
        </label>
        {layOnTimeline && (
          <label className="flex items-center gap-2 pl-5 text-[10px] text-muted-foreground">
            <input
              type="checkbox"
              className="rounded border-border"
              checked={useLightCrossfade}
              disabled={busy || disabled}
              onChange={(event) => setUseLightCrossfade(event.target.checked)}
            />
            {t('director.batch.lightCrossfade', {
              defaultValue: 'Light crossfade between cuts (optional)',
            })}
          </label>
        )}
        {layOnTimeline && !audioContext.hasAudio && (
          <p className="text-[10px] text-amber-400">
            {t('director.batch.audioRequired', {
              defaultValue: 'Timeline audio required — place your track before confirming.',
            })}
          </p>
        )}
        {timelinePlaced && (
          <p className="text-[10px] text-emerald-400">
            {t('director.batch.timelinePlacedHint', {
              defaultValue: 'Rough cut is on the timeline — trim and move clips freely.',
            })}
          </p>
        )}
      </div>

      {quote && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-medium text-foreground">
            {t('director.batch.pathLabel', { defaultValue: 'Render path' })}
          </p>
          <div className="space-y-1.5">
            {paths.map((option) => {
              const total = totalCrtvaiForPath(quote, option, perShotOverrides)
              const isSelected = path === option
              return (
                <button
                  key={option}
                  type="button"
                  disabled={busy || disabled}
                  onClick={() => setPath(option)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                    isSelected
                      ? 'border-primary/50 bg-primary/10 ring-1 ring-primary/30'
                      : 'border-border/70 bg-secondary/15 hover:bg-secondary/30',
                    (busy || disabled) && 'pointer-events-none opacity-60',
                  )}
                >
                  <span className="text-[11px] font-medium text-foreground">
                    {pathLabel(option, t)}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-foreground">
                    {total.crtvaiDisplay.toFixed(total.crtvaiDisplay < 1 ? 3 : 2)} CRTVAI
                    <span className="ml-1 text-muted-foreground">({total.formattedUsd})</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {showPerShotOverrides && quote && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] font-medium text-foreground">
            {t('director.batch.perShot', { defaultValue: 'Per-shot provider (optional)' })}
          </p>
          {quote.shots.map((shot) => (
            <div
              key={shot.shotId}
              className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5"
            >
              <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                {shot.shotId}: {shot.generate.prompt.slice(0, 48)}
                {shot.generate.prompt.length > 48 ? '…' : ''}
              </span>
              <select
                className="shrink-0 rounded border border-border bg-secondary/30 px-1.5 py-0.5 text-[10px]"
                disabled={busy || disabled}
                value={perShotOverrides[shot.shotId] ?? ''}
                onChange={(event) => {
                  const value = event.target.value as PixelsRenderProvider | ''
                  setPerShotOverrides((prev) => {
                    const next = { ...prev }
                    if (!value) {
                      delete next[shot.shotId]
                    } else {
                      next[shot.shotId] = value
                    }
                    return next
                  })
                }}
              >
                <option value="">
                  {path === 'recommendedMix'
                    ? shot.recommendedProvider
                    : path === 'allVeo'
                      ? 'veo'
                      : 'seedance'}
                </option>
                <option value="veo">Veo</option>
                <option value="seedance">Seedance</option>
              </select>
            </div>
          ))}
        </div>
      )}

      {jobs.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">
              {t('director.batch.progress', {
                defaultValue: '{{done}} of {{total}} complete',
                done: progress.completed,
                total: progress.total,
              })}
            </span>
            {phase === 'running' && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            )}
          </div>
          <ul className="max-h-36 space-y-1 overflow-y-auto">
            {jobs.map((job) => (
              <li
                key={job.shotId}
                className="flex items-center gap-2 rounded-md border border-border/50 bg-background/30 px-2 py-1"
              >
                {statusIcon(job.status)}
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground">
                  {job.shotId}
                </span>
                <span className="text-[10px] text-muted-foreground capitalize">{job.provider}</span>
                {job.status === 'running' && (
                  <span className="font-mono text-[10px] text-muted-foreground">{job.progress}%</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {quoteExpired && (
        <p className="mt-2 text-[11px] text-amber-400">
          {t('director.batch.quoteExpired', {
            defaultValue: 'Batch quote expired — refresh before confirming.',
          })}
        </p>
      )}

      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {quoteExpired && !busy && (
          <Button size="sm" variant="secondary" disabled={disabled} onClick={() => void loadQuote()}>
            {t('director.batch.refreshQuote', { defaultValue: 'Refresh quote' })}
          </Button>
        )}
        {!activeJob && (
          <Button
            size="sm"
            disabled={busy || disabled || !quote || !auth || !currentProjectId || quoteExpired}
            onClick={() => void handleConfirm()}
          >
            {phase === 'confirming' || phase === 'running' ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {t('director.batch.confirm', {
              defaultValue: 'Confirm & render all',
            })}
          </Button>
        )}
        {failedJobs.length > 0 && !busy && (
          <Button size="sm" variant="secondary" onClick={() => void handleRetryFailed()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t('director.batch.retry', {
              defaultValue: 'Retry {{count}} failed',
              count: failedJobs.length,
            })}
          </Button>
        )}
        {canPlaceOnTimeline && !busy && (
          <Button
            size="sm"
            variant="secondary"
            disabled={placingTimeline}
            onClick={() => void handleLayOnTimeline()}
          >
            {placingTimeline ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Film className="mr-1.5 h-3.5 w-3.5" />
            )}
            {timelinePlaced
              ? t('director.batch.layOnTimelineAgain', { defaultValue: 'Lay on timeline again' })
              : t('director.batch.layOnTimelineCta', { defaultValue: 'Lay on timeline' })}
          </Button>
        )}
        {phase === 'quoting' && (
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('director.batch.quoting', { defaultValue: 'Fetching batch quote…' })}
          </span>
        )}
      </div>

      {selectedTotal && (
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">
          {t('director.batch.due', {
            defaultValue: 'Due: {{amount}} CRTVAI · Balance: {{balance}} CRTVAI',
            amount: selectedTotal.crtvaiDisplay.toFixed(selectedTotal.crtvaiDisplay < 1 ? 3 : 2),
            balance: balance.toFixed(2),
          })}
        </p>
      )}

      <BuyMetokenModal open={buyOpen} onOpenChange={setBuyOpen} />
    </div>
  )
})
