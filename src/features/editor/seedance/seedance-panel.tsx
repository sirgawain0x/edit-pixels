import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clapperboard, Loader2, Sparkles, WandSparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useWalletContext } from '@/context/wallet-context'
import { useCredits } from '@/features/editor/deps/credits-contract'
import { useMediaLibraryStore } from '@/features/editor/deps/media-library'
import { useGenerativeAuth } from '@/features/editor/deps/generative'
import { BuyMetokenModal } from '@/features/editor/deps/metoken'
import { getDirectorTreasuryAddress } from '../director/build-director-payment'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import {
  useItemsStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-store-contract'
import {
  buildDirectorTimelineAudioContext,
  formatTimelineAudioForPrompt,
} from '../director/timeline-audio'
import { usePlaybackStore } from '@/shared/state/playback'
import { isSeedanceGenerateEnabled, type SeedanceResolution } from '@/config/seedance'
import {
  quotePixelsRenderOptions,
  type PixelsRenderProvider,
} from '@/config/pixels-render'
import { cn } from '@/shared/ui/cn'
import { planSeedanceShot, quotePixelsRender } from './seedance-client'
import type { PixelsRenderQuotesResponse, SeedanceShotBrief } from './seedance-client'
import { PixelsRenderProviderPicker } from './pixels-render-provider-picker'
import { importRenderVideoToTimeline } from './import-render-to-timeline'
import {
  clearPixelsGenerateJob,
  loadPixelsGenerateJob,
  savePixelsGenerateJob,
  type PixelsGenerateActiveJob,
} from './pixels-generate-job-store'
import {
  mapPixelsGenerateError,
  startPixelsGenerateEvent,
} from './pixels-generate-telemetry'
import {
  pollSeedanceTaskToVideo,
  pollVeoTaskToVideo,
  resolveVeoTaskId,
  runProviderGenerate,
} from './pixels-generate-helpers'

type Phase = 'idle' | 'planning' | 'ready' | 'generating'

// fallow-ignore-next-line complexity
export const SeedancePanel = memo(function SeedancePanel() {
  const { t } = useTranslation()
  const { connect, authenticated, configured: walletConfigured } = useWalletContext()
  const { balance, refreshBalance } = useCredits()
  const { sendOps, ready: walletOpsReady } = useSmartWalletOps()
  const auth = useGenerativeAuth()
  const canPayOnChain = Boolean(getDirectorTreasuryAddress() && walletOpsReady)
  const currentProjectId = useMediaLibraryStore((s) => s.currentProjectId)
  const items = useItemsStore((s) => s.items)
  const fps = useTimelineSettingsStore((s) => s.fps)

  const [idea, setIdea] = useState('')
  const [brief, setBrief] = useState<SeedanceShotBrief | null>(null)
  const [resolution, setResolution] = useState<SeedanceResolution>('720p')
  const [renderProvider, setRenderProvider] = useState<PixelsRenderProvider | null>(null)
  const [serverQuotes, setServerQuotes] = useState<PixelsRenderQuotesResponse | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState<string | null>(null)
  const [buyOpen, setBuyOpen] = useState(false)

  const generateAbortRef = useRef<AbortController | null>(null)
  const resumeAttemptedRef = useRef(false)

  const renderOptions = useMemo(() => {
    if (!brief) return []
    return quotePixelsRenderOptions(brief.duration, resolution)
  }, [brief, resolution])

  const selectedQuote = useMemo(() => {
    if (!renderProvider || !serverQuotes) return null
    return renderProvider === 'veo' ? serverQuotes.veo : serverQuotes.seedance
  }, [renderProvider, serverQuotes])

  const insufficient = selectedQuote ? balance < selectedQuote.crtvaiDisplay : false
  const busy = phase === 'planning' || phase === 'generating'

  const timelineContext = useMemo(() => {
    const audioContext = buildDirectorTimelineAudioContext(items, fps)
    return formatTimelineAudioForPrompt(audioContext)
  }, [items, fps])

  const setProgressStatus = useCallback(
    (pct: number) => {
      setStatus(
        t('seedance.status.progress', {
          defaultValue: 'Rendering… {{pct}}%',
          pct,
        }),
      )
    },
    [t],
  )

  const finishImport = useCallback(
    async (
      videoUrl: string,
      provider: PixelsRenderProvider,
      projectId: string,
      playheadFrame: number,
    ) => {
      setStatus(t('seedance.status.importing', { defaultValue: 'Importing to timeline…' }))
      const tags =
        provider === 'seedance'
          ? ['ai-generated', 'seedance']
          : ['ai-generated', 'veo', 'pixels']
      const { inserted, fileName } = await importRenderVideoToTimeline(
        videoUrl,
        projectId,
        playheadFrame,
        tags,
      )

      if (inserted) {
        toast.success(
          t('seedance.success.timeline', {
            defaultValue: 'Clip added at the playhead.',
          }),
        )
      } else {
        toast.warning(
          t('seedance.success.library', {
            defaultValue: 'Video saved to library but could not place on timeline.',
            fileName,
          }),
        )
      }

      clearPixelsGenerateJob()
      setBrief(null)
      setServerQuotes(null)
      setRenderProvider(null)
      setPhase('idle')
      setStatus(null)
    },
    [t],
  )

  const handleGenerateError = useCallback(
    (error: unknown, telemetry?: ReturnType<typeof startPixelsGenerateEvent>) => {
      if (error instanceof DOMException && error.name === 'AbortError') {
        telemetry?.failure(error, { outcome: 'cancelled' })
        clearPixelsGenerateJob()
        setPhase('ready')
        setStatus(null)
        return
      }

      const mapped = mapPixelsGenerateError(error)
      telemetry?.failure(error, { outcome: mapped.code })

      if (mapped.code === 'insufficient_crtvai') {
        setBuyOpen(true)
      }

      toast.error(mapped.message)
      clearPixelsGenerateJob()
      setPhase('ready')
      setStatus(null)
    },
    [],
  )

  const runGenerate = useCallback(
    async (
      input: PixelsGenerateActiveJob,
      crtvaiRequired: string,
      costUsdc6: number,
      seedanceQuoteId?: string,
    ) => {
      const telemetry = startPixelsGenerateEvent({
        provider: input.provider,
        durationSec: input.brief.duration,
        costUsdc6,
        resolution: input.provider === 'seedance' ? input.resolution : '720p',
      })

      const abortController = new AbortController()
      generateAbortRef.current = abortController
      savePixelsGenerateJob(input)
      setPhase('generating')

      try {
        if (!auth) throw new Error('Not authenticated')
        if (input.provider === 'seedance') {
          setStatus(
            t('seedance.status.generatingSeedance', {
              defaultValue: 'Generating with Seedance 2.5…',
            }),
          )
        } else {
          setStatus(
            t('seedance.status.generatingVeo', {
              defaultValue: 'Generating Gemini still + Veo 3.1…',
            }),
          )
        }
        const videoUrl = await runProviderGenerate(auth, input, crtvaiRequired, {
          canPayOnChain,
          sendOps,
          refreshBalance,
          onProgress: setProgressStatus,
          seedanceQuoteId,
          signal: abortController.signal,
        })
        telemetry.success({ outcome: 'completed' })
        await finishImport(videoUrl, input.provider, input.projectId, input.playheadFrame)
      } catch (error) {
        handleGenerateError(error, telemetry)
      } finally {
        generateAbortRef.current = null
      }
    },
    [
      auth,
      canPayOnChain,
      finishImport,
      handleGenerateError,
      refreshBalance,
      sendOps,
      setProgressStatus,
      t,
    ],
  )

  useEffect(() => {
    if (!auth || !brief || phase !== 'ready') return
    void quotePixelsRender(auth, { duration: brief.duration, resolution })
      .then(setServerQuotes)
      .catch(() => {
        // Client-side quotes still shown; server re-validates on generate.
      })
  }, [auth, brief, phase, resolution])

  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (!auth || !currentProjectId || resumeAttemptedRef.current) return
    const saved = loadPixelsGenerateJob()
    if (!saved || saved.projectId !== currentProjectId) return

    resumeAttemptedRef.current = true
    setBrief(saved.brief)
    setResolution(saved.resolution)
    setRenderProvider(saved.provider)
    setPhase('generating')
    setStatus(t('seedance.status.resuming', { defaultValue: 'Resuming generation…' }))

    void (async () => {
      const telemetry = startPixelsGenerateEvent({
        provider: saved.provider,
        durationSec: saved.brief.duration,
        costUsdc6: 0,
        resolution: saved.provider === 'seedance' ? saved.resolution : '720p',
      })
      telemetry.set('resumed', true)

      try {
        const videoUrl =
          saved.provider === 'seedance'
            ? await pollSeedanceTaskToVideo(auth, saved.requestId, setProgressStatus)
            : await (async () => {
                const resolved = await resolveVeoTaskId(auth, saved)
                if ('videoUrl' in resolved) return resolved.videoUrl
                return pollVeoTaskToVideo(auth, resolved.veoTaskId, {
                  onProgress: setProgressStatus,
                })
              })()

        telemetry.success({ outcome: 'completed' })
        await finishImport(videoUrl, saved.provider, saved.projectId, saved.playheadFrame)
      } catch (error) {
        handleGenerateError(error, telemetry)
      }
    })()
  }, [auth, currentProjectId, finishImport, handleGenerateError, setProgressStatus, t])

  const planShot = useCallback(async () => {
    if (!walletConfigured) {
      toast.error(t('seedance.error.wallet', { defaultValue: 'Connect a wallet to use Generate.' }))
      return
    }
    if (!authenticated) {
      connect()
      return
    }
    if (!auth) {
      toast.error(t('seedance.error.auth', { defaultValue: 'Wallet auth required.' }))
      return
    }
    const trimmed = idea.trim()
    if (!trimmed) {
      toast.error(t('seedance.error.idea', { defaultValue: 'Describe the shot you want.' }))
      return
    }

    setPhase('planning')
    setRenderProvider(null)
    setServerQuotes(null)
    setStatus(t('seedance.status.planning', { defaultValue: 'Planning shot with Gemini…' }))
    try {
      const planned = await planSeedanceShot(auth, {
        idea: trimmed,
        timelineContext,
      })
      setBrief(planned)
      const quotes = await quotePixelsRender(auth, {
        duration: planned.duration,
        resolution,
      })
      setServerQuotes(quotes)
      setPhase('ready')
      setStatus(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Planning failed')
      setPhase('idle')
      setStatus(null)
    }
  }, [auth, authenticated, connect, idea, resolution, t, timelineContext, walletConfigured])

  const confirmAndGenerate = useCallback(async () => {
    if (!auth || !brief || !selectedQuote || !renderProvider || !currentProjectId) return
    if (insufficient) {
      setBuyOpen(true)
      toast.error(
        t('seedance.error.insufficient', { defaultValue: 'Insufficient CRTVAI for this generation.' }),
      )
      return
    }

    const playheadFrame = usePlaybackStore.getState().currentFrame
    await runGenerate(
      {
        requestId: crypto.randomUUID(),
        provider: renderProvider,
        projectId: currentProjectId,
        playheadFrame,
        brief,
        resolution,
        seedanceQuoteId:
          renderProvider === 'seedance' ? serverQuotes?.seedance.quoteId : undefined,
        startedAtMs: Date.now(),
      },
      selectedQuote.crtvaiRequired,
      selectedQuote.estimatedUsdc6,
      renderProvider === 'seedance' ? serverQuotes?.seedance.quoteId : undefined,
    )
  }, [
    auth,
    brief,
    currentProjectId,
    insufficient,
    renderProvider,
    resolution,
    runGenerate,
    selectedQuote,
    serverQuotes?.seedance.quoteId,
    t,
  ])

  const cancelGenerate = useCallback(() => {
    generateAbortRef.current?.abort()
  }, [])

  if (!isSeedanceGenerateEnabled()) {
    return null
  }

  const canConfirm = phase === 'ready' && brief && selectedQuote && renderProvider

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border/60 px-3 py-2.5">
        <p className="font-mono text-[10px] tracking-[0.18em] text-primary/85 uppercase">
          {t('seedance.eyebrow', { defaultValue: 'Creative Pixels' })}
        </p>
        <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
          {t('seedance.title', { defaultValue: 'Generate video' })}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t('seedance.blurb', {
            defaultValue:
              'Plan with Gemini, compare render providers and CRTVAI cost, then confirm.',
          })}
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div className="space-y-1.5">
          <Label className="text-[11px]">{t('seedance.idea', { defaultValue: 'Shot idea' })}</Label>
          <Textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder={t('seedance.ideaPlaceholder', {
              defaultValue: 'A character walks through neon rain, camera tracks from behind…',
            })}
            className="min-h-[72px] resize-none text-[12px]"
          />
        </div>

        {brief && (
          <div className="space-y-2 rounded-xl border border-border/70 bg-secondary/20 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              <Clapperboard className="h-3.5 w-3.5 text-primary" />
              {t('seedance.plannedShot', { defaultValue: 'Planned shot (Gemini)' })}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{brief.prompt}</p>
            <dl className="grid grid-cols-2 gap-1 font-mono text-[10px] text-muted-foreground">
              <div>
                <dt>{t('seedance.duration', { defaultValue: 'Duration' })}</dt>
                <dd className="text-foreground">{brief.duration}s</dd>
              </div>
              <div>
                <dt>{t('seedance.framing', { defaultValue: 'Framing' })}</dt>
                <dd className="text-foreground">{brief.framing}</dd>
              </div>
              <div>
                <dt>{t('seedance.aspect', { defaultValue: 'Aspect' })}</dt>
                <dd className="text-foreground">{brief.aspect_ratio}</dd>
              </div>
            </dl>
          </div>
        )}

        {brief && phase !== 'idle' && (
          <>
            <div className="space-y-1">
              <Label className="text-[11px]">
                {t('seedance.seedanceResolution', {
                  defaultValue: 'Seedance resolution (Veo uses 720p)',
                })}
              </Label>
              <Select
                value={resolution}
                onValueChange={(v) => {
                  setResolution(v as SeedanceResolution)
                  setRenderProvider(null)
                }}
                disabled={busy}
              >
                <SelectTrigger className="h-8 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="720p">720p (default)</SelectItem>
                  <SelectItem value="480p">480p</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <PixelsRenderProviderPicker
              options={renderOptions}
              selected={renderProvider}
              onSelect={setRenderProvider}
              disabled={busy}
            />
          </>
        )}

        {selectedQuote && (
          <div className="rounded-xl border border-primary/30 bg-secondary/25 p-3">
            <dl className="space-y-1 font-mono text-[11px]">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  {t('seedance.selectedProvider', { defaultValue: 'Selected' })}
                </dt>
                <dd className="text-foreground">{selectedQuote.label}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Due</dt>
                <dd className="font-semibold">
                  {selectedQuote.crtvaiDisplay.toFixed(
                    selectedQuote.crtvaiDisplay < 1 ? 3 : 2,
                  )}{' '}
                  CRTVAI
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    ({selectedQuote.formattedUsd})
                  </span>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Balance</dt>
                <dd className={cn(insufficient ? 'text-destructive' : 'text-foreground')}>
                  {balance.toFixed(2)} CRTVAI
                </dd>
              </div>
            </dl>
            {!canPayOnChain && (
              <p className="mt-2 text-[10px] text-amber-200/90">
                {t('seedance.softPay', {
                  defaultValue: 'Treasury not configured — on-chain charge skipped locally.',
                })}
              </p>
            )}
            {insufficient && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2 h-8 w-full text-[11px]"
                onClick={() => setBuyOpen(true)}
              >
                {t('seedance.buy', { defaultValue: 'Buy CRTVAI' })}
              </Button>
            )}
          </div>
        )}

        {status && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {status}
          </p>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border/60 p-3">
        {phase === 'generating' ? (
          <Button
            type="button"
            variant="secondary"
            className="h-9 w-full gap-1.5 text-[12px]"
            onClick={cancelGenerate}
          >
            <X className="h-3.5 w-3.5" />
            {t('seedance.cancel', { defaultValue: 'Cancel generation' })}
          </Button>
        ) : canConfirm ? (
          <Button
            type="button"
            className="h-9 w-full gap-1.5 text-[12px]"
            disabled={busy || !renderProvider}
            onClick={() => void confirmAndGenerate()}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {selectedQuote
              ? t('seedance.confirmGenerate', {
                  defaultValue: 'Confirm {{amount}} CRTVAI & generate',
                  amount: selectedQuote.crtvaiDisplay.toFixed(
                    selectedQuote.crtvaiDisplay < 1 ? 3 : 2,
                  ),
                })
              : t('seedance.pickProvider', { defaultValue: 'Pick a render provider' })}
          </Button>
        ) : (
          <Button
            type="button"
            className="h-9 w-full gap-1.5 text-[12px]"
            disabled={busy || !idea.trim()}
            onClick={() => void planShot()}
          >
            {phase === 'planning' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <WandSparkles className="h-3.5 w-3.5" />
            )}
            {phase === 'planning'
              ? t('seedance.planning', { defaultValue: 'Planning…' })
              : t('seedance.plan', { defaultValue: 'Plan shot' })}
          </Button>
        )}
      </div>

      <BuyMetokenModal
        open={buyOpen}
        onOpenChange={setBuyOpen}
        initialUsdcAmount={
          selectedQuote
            ? Math.max(1, Math.ceil(selectedQuote.estimatedUsdc6 / 1_000_000)).toFixed(2)
            : '1.00'
        }
      />
    </div>
  )
})
