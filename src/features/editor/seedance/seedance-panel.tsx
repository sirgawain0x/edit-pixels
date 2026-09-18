import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clapperboard, Loader2, Sparkles, WandSparkles } from 'lucide-react'
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
import {
  importMediaLibraryService,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library'
import { useGenerativeAuth } from '@/features/editor/deps/generative'
import { BuyMetokenModal } from '@/features/editor/deps/metoken'
import {
  getDirectorTreasuryAddress,
  buildDirectorPaymentOp,
} from '../director/build-director-payment'
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
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { insertGeneratedVideoOnNewTrack } from '../utils/insert-generated-video'
import {
  isSeedanceGenerateEnabled,
  quoteSeedanceGeneration,
  type SeedanceAspectRatio,
  type SeedanceResolution,
} from '@/config/seedance'
import { cn } from '@/shared/ui/cn'
import { generateSeedance, planSeedanceShot, quoteSeedance } from './seedance-client'
import type { SeedanceShotBrief } from './seedance-client'

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
  const loadMediaItems = useMediaLibraryStore((s) => s.loadMediaItems)
  const items = useItemsStore((s) => s.items)
  const fps = useTimelineSettingsStore((s) => s.fps)

  const [idea, setIdea] = useState('')
  const [brief, setBrief] = useState<SeedanceShotBrief | null>(null)
  const [resolution, setResolution] = useState<SeedanceResolution>('720p')
  const [quoteId, setQuoteId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState<string | null>(null)
  const [buyOpen, setBuyOpen] = useState(false)

  const localQuote = useMemo(() => {
    if (!brief) return null
    return quoteSeedanceGeneration({ duration: brief.duration, resolution })
  }, [brief, resolution])

  const insufficient = localQuote ? balance < localQuote.crtvaiDisplay : false
  const busy = phase === 'planning' || phase === 'generating'

  const timelineContext = useMemo(() => {
    const audioContext = buildDirectorTimelineAudioContext(items, fps)
    return formatTimelineAudioForPrompt(audioContext)
  }, [items, fps])

  useEffect(() => {
    if (!auth || !brief || phase !== 'ready') return
    void quoteSeedance(auth, { duration: brief.duration, resolution })
      .then((serverQuote) => setQuoteId(serverQuote.quoteId))
      .catch(() => {
        // Keep prior quote on transient failure; generate will re-quote server-side.
      })
  }, [auth, brief, phase, resolution])

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
    setStatus(t('seedance.status.planning', { defaultValue: 'Planning shot with Gemini…' }))
    try {
      const planned = await planSeedanceShot(auth, {
        idea: trimmed,
        timelineContext,
      })
      setBrief(planned)
      const serverQuote = await quoteSeedance(auth, {
        duration: planned.duration,
        resolution,
      })
      setQuoteId(serverQuote.quoteId)
      setPhase('ready')
      setStatus(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Planning failed')
      setPhase('idle')
      setStatus(null)
    }
  }, [auth, authenticated, connect, idea, resolution, t, timelineContext, walletConfigured])

  const confirmAndGenerate = useCallback(async () => {
    if (!auth || !brief || !localQuote || !quoteId) return
    if (!currentProjectId) {
      toast.error(t('seedance.error.project', { defaultValue: 'Open a project first.' }))
      return
    }
    if (insufficient) {
      setBuyOpen(true)
      toast.error(
        t('seedance.error.insufficient', { defaultValue: 'Insufficient CRTVAI for this generation.' }),
      )
      return
    }

    const playheadFrame = usePlaybackStore.getState().currentFrame
    setPhase('generating')
    setStatus(t('seedance.status.paying', { defaultValue: 'Confirming payment…' }))

    try {
      let paymentTxHash: string | undefined
      if (canPayOnChain) {
        const { txHash } = await sendOps([buildDirectorPaymentOp(localQuote.crtvaiWei)])
        paymentTxHash = txHash
        refreshBalance()
      }

      setStatus(t('seedance.status.generating', { defaultValue: 'Generating with Seedance 2.5…' }))
      const result = await generateSeedance(auth, {
        prompt: brief.prompt,
        duration: brief.duration,
        resolution,
        aspect_ratio: (brief.aspect_ratio as SeedanceAspectRatio) || '16:9',
        quoteId,
        requestId: crypto.randomUUID(),
        ...(paymentTxHash ? { paymentTxHash } : {}),
      })

      if (result.status !== 'completed' || !result.output?.video_url) {
        throw new Error(result.error?.message ?? 'Generation failed')
      }

      setStatus(t('seedance.status.importing', { defaultValue: 'Importing to timeline…' }))
      const response = await fetch(result.output.video_url)
      if (!response.ok) throw new Error('Failed to download generated video')
      const blob = await response.blob()
      const file = new File([blob], `seedance-${Date.now()}.mp4`, {
        type: blob.type || 'video/mp4',
      })

      const { mediaLibraryService } = await importMediaLibraryService()
      const media = await mediaLibraryService.importGeneratedVideo(file, currentProjectId, {
        tags: ['ai-generated', 'seedance'],
      })
      const blobUrl = blobUrlManager.acquire(media.id, file)
      await loadMediaItems()

      const inserted = insertGeneratedVideoOnNewTrack(media, blobUrl, playheadFrame)
      if (inserted) {
        toast.success(
          t('seedance.success.timeline', {
            defaultValue: 'Seedance clip added at the playhead.',
          }),
        )
      } else {
        toast.warning(
          t('seedance.success.library', {
            defaultValue: 'Video saved to library but could not place on timeline.',
          }),
        )
      }

      setBrief(null)
      setQuoteId(null)
      setPhase('idle')
      setStatus(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generation failed')
      setPhase('ready')
      setStatus(null)
    }
  }, [
    auth,
    brief,
    canPayOnChain,
    currentProjectId,
    insufficient,
    loadMediaItems,
    localQuote,
    quoteId,
    refreshBalance,
    resolution,
    sendOps,
    t,
  ])

  if (!isSeedanceGenerateEnabled()) {
    return null
  }

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
              'Plan a shot with Gemini, review CRTVAI cost, then generate with Seedance 2.5.',
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

        <div className="space-y-1">
          <Label className="text-[11px]">{t('seedance.resolution', { defaultValue: 'Resolution' })}</Label>
          <Select
            value={resolution}
            onValueChange={(v) => setResolution(v as SeedanceResolution)}
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

        {brief && (
          <div className="space-y-2 rounded-xl border border-border/70 bg-secondary/20 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              <Clapperboard className="h-3.5 w-3.5 text-primary" />
              {t('seedance.plannedShot', { defaultValue: 'Planned shot' })}
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

        {localQuote && phase !== 'idle' && (
          <div className="rounded-xl border border-primary/30 bg-secondary/25 p-3">
            <dl className="space-y-1 font-mono text-[11px]">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Due</dt>
                <dd className="font-semibold">
                  {localQuote.crtvaiDisplay.toFixed(localQuote.crtvaiDisplay < 1 ? 3 : 2)} CRTVAI
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    ({localQuote.formattedUsd})
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
        {phase === 'ready' && brief && localQuote ? (
          <Button
            type="button"
            className="h-9 w-full gap-1.5 text-[12px]"
            disabled={busy}
            onClick={() => void confirmAndGenerate()}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {t('seedance.confirmGenerate', {
              defaultValue: 'Confirm {{amount}} CRTVAI & generate',
              amount: localQuote.crtvaiDisplay.toFixed(localQuote.crtvaiDisplay < 1 ? 3 : 2),
            })}
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
          localQuote
            ? Math.max(1, Math.ceil(localQuote.estimatedUsdc6 / 1_000_000)).toFixed(2)
            : '1.00'
        }
      />
    </div>
  )
})
