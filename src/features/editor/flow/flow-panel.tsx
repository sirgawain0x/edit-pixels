import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft, ImagePlus, Loader2, Sparkles, Upload, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BuyMetokenModal } from '@/features/metoken/components/buy-metoken-modal'
import { useWalletContext } from '@/context/wallet-context'
import { useCredits } from '@/features/editor/deps/credits-contract'
import {
  importMediaLibraryService,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library'
import {
  getDirectorTreasuryAddress,
  buildDirectorPaymentOp,
} from '../director/build-director-payment'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import {
  FLOW_DURATION_DEFAULT_SEC,
  FLOW_DURATION_MAX_SEC,
  FLOW_DURATION_MIN_SEC,
  clampFlowDuration,
} from '@/config/flow'
import { quoteFlowGeneration } from './flow-pricing'
import {
  getPublicImageUrl,
  pollTask,
  proxyFlowRun,
  proxyGetTask,
  useGenerativeAuth,
} from '@/features/generative'
import { cn } from '@/shared/ui/cn'

type FrameSlot = {
  previewUrl: string | null
  publicUrl: string | null
  generatePrompt: string
  mode: 'upload' | 'generate'
}

const emptySlot = (): FrameSlot => ({
  previewUrl: null,
  publicUrl: null,
  generatePrompt: '',
  mode: 'upload',
})

async function importRemoteVideo(url: string, projectId: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to download generated video')
  const blob = await response.blob()
  const file = new File([blob], `flow-${Date.now()}.mp4`, {
    type: blob.type || 'video/mp4',
  })
  const { mediaLibraryService } = await importMediaLibraryService()
  await mediaLibraryService.importGeneratedVideo(file, projectId, {
    tags: ['ai-generated', 'flow', 'seedance'],
  })
}

// fallow-ignore-next-line complexity
export const FlowPanel = memo(function FlowPanel() {
  const { t } = useTranslation()
  const fileStartRef = useRef<HTMLInputElement>(null)
  const fileEndRef = useRef<HTMLInputElement>(null)

  const { connect, authenticated, configured: walletConfigured } = useWalletContext()
  const { balance, refreshBalance } = useCredits()
  const { sendOps, ready: walletOpsReady } = useSmartWalletOps()
  const auth = useGenerativeAuth()
  const canPayOnChain = Boolean(getDirectorTreasuryAddress() && walletOpsReady)
  const currentProjectId = useMediaLibraryStore((s) => s.currentProjectId)
  const loadMediaItems = useMediaLibraryStore((s) => s.loadMediaItems)

  const [start, setStart] = useState<FrameSlot>(emptySlot)
  const [end, setEnd] = useState<FrameSlot>(emptySlot)
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(FLOW_DURATION_DEFAULT_SEC)
  const [quality, setQuality] = useState<'480p' | '720p' | '1080p'>('720p')
  const [speed, setSpeed] = useState<'standard' | 'fast'>('standard')
  const [generateAudio, setGenerateAudio] = useState(true)
  const [chainNext, setChainNext] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [buyOpen, setBuyOpen] = useState(false)
  const [lastEndUrl, setLastEndUrl] = useState<string | null>(null)

  const stillCount =
    (start.mode === 'generate' && !start.publicUrl && start.generatePrompt.trim() ? 1 : 0) +
    (end.mode === 'generate' && !end.publicUrl && end.generatePrompt.trim() ? 1 : 0)

  const quote = useMemo(
    () =>
      quoteFlowGeneration({
        duration,
        quality,
        speed,
        generateAudio,
        stillCount,
      }),
    [duration, quality, speed, generateAudio, stillCount],
  )

  const insufficient = balance < quote.crtvaiDisplay

  const assignFile = useCallback(
    async (file: File, which: 'start' | 'end') => {
      if (!auth) {
        toast.error(t('flow.error.auth', { defaultValue: 'Wallet auth required for Flow.' }))
        return
      }
      const previewUrl = URL.createObjectURL(file)
      const publicUrl = await getPublicImageUrl(file, auth)
      const patch = { previewUrl, publicUrl, mode: 'upload' as const, generatePrompt: '' }
      if (which === 'start') setStart((s) => ({ ...s, ...patch }))
      else setEnd((s) => ({ ...s, ...patch }))
    },
    [auth, t],
  )

  const onFile = useCallback(
    (which: 'start' | 'end', files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      void assignFile(file, which).catch((e) =>
        toast.error(e instanceof Error ? e.message : 'Upload failed'),
      )
    },
    [assignFile],
  )

  const continueFromLast = useCallback(() => {
    if (!lastEndUrl) return
    setStart({
      previewUrl: lastEndUrl,
      publicUrl: lastEndUrl,
      generatePrompt: '',
      mode: 'upload',
    })
    setEnd(emptySlot())
    setChainNext(true)
    toast.message(
      t('flow.chain.ready', {
        defaultValue: 'Start frame set from last segment. Add a new end frame to continue.',
      }),
    )
  }, [lastEndUrl, t])

  const runFlow = useCallback(async () => {
    if (busy) return
    if (!currentProjectId) {
      toast.error(t('flow.error.noProject', { defaultValue: 'Open a project first.' }))
      return
    }
    if (walletConfigured && !authenticated) {
      connect()
      toast.error(
        t('flow.error.connect', { defaultValue: 'Connect your wallet to pay in CRTVAI.' }),
      )
      return
    }
    if (!auth) {
      toast.error(t('flow.error.auth', { defaultValue: 'Wallet auth required for Flow.' }))
      return
    }
    if (!prompt.trim()) {
      toast.error(t('flow.error.prompt', { defaultValue: 'Describe the motion between frames.' }))
      return
    }
    const hasStart = Boolean(start.publicUrl) || Boolean(start.generatePrompt.trim())
    const hasEnd = Boolean(end.publicUrl) || Boolean(end.generatePrompt.trim())
    if (!hasStart || !hasEnd) {
      toast.error(
        t('flow.error.frames', {
          defaultValue: 'Provide a start and end image (upload or Gemini prompt).',
        }),
      )
      return
    }
    if (insufficient) {
      setBuyOpen(true)
      toast.error(
        t('flow.error.insufficient', { defaultValue: 'Insufficient CRTVAI for this Flow.' }),
      )
      return
    }

    setBusy(true)
    setProgress(0)
    setStatus(t('flow.status.paying', { defaultValue: 'Confirming payment…' }))
    try {
      let paymentTxHash: string | undefined
      if (canPayOnChain) {
        const { txHash } = await sendOps([buildDirectorPaymentOp(quote.crtvaiWei)])
        paymentTxHash = txHash
        refreshBalance()
      }

      setStatus(t('flow.status.generating', { defaultValue: 'Generating segment…' }))
      const task = await proxyFlowRun(auth, {
        prompt: prompt.trim(),
        duration: clampFlowDuration(duration),
        quality,
        speed,
        generate_audio: generateAudio,
        ...(start.publicUrl ? { startImageUrl: start.publicUrl } : {}),
        ...(end.publicUrl ? { endImageUrl: end.publicUrl } : {}),
        ...(!start.publicUrl && start.generatePrompt.trim()
          ? { startPrompt: start.generatePrompt.trim() }
          : {}),
        ...(!end.publicUrl && end.generatePrompt.trim()
          ? { endPrompt: end.generatePrompt.trim() }
          : {}),
        stillQuality: '2K',
        ...(paymentTxHash ? { paymentTxHash } : {}),
      })

      if (task.startImageUrl) {
        setStart((s) => ({
          ...s,
          publicUrl: task.startImageUrl!,
          previewUrl: task.startImageUrl!,
        }))
      }
      if (task.endImageUrl) {
        setEnd((s) => ({
          ...s,
          publicUrl: task.endImageUrl!,
          previewUrl: task.endImageUrl!,
        }))
        setLastEndUrl(task.endImageUrl)
      }

      const final = await pollTask((signal) => proxyGetTask(task.id, signal, auth), {
        onProgress: (d) => {
          setProgress(d.progress ?? 0)
          setStatus(
            t('flow.status.progress', {
              defaultValue: 'Rendering… {{pct}}%',
              pct: Math.round(d.progress ?? 0),
            }),
          )
        },
      })

      if (final.status !== 'completed' || !final.output?.video_url) {
        throw new Error(final.error?.message || 'Flow generation failed')
      }

      setStatus(t('flow.status.importing', { defaultValue: 'Importing to library…' }))
      await importRemoteVideo(final.output.video_url, currentProjectId)
      await loadMediaItems()
      toast.success(t('flow.success', { defaultValue: 'Flow segment added to media library.' }))

      if (chainNext && task.endImageUrl) {
        setStart({
          previewUrl: task.endImageUrl,
          publicUrl: task.endImageUrl,
          generatePrompt: '',
          mode: 'upload',
        })
        setEnd(emptySlot())
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Flow failed')
    } finally {
      setBusy(false)
      setStatus(null)
      setProgress(0)
    }
  }, [
    auth,
    authenticated,
    busy,
    canPayOnChain,
    chainNext,
    connect,
    currentProjectId,
    duration,
    end,
    generateAudio,
    insufficient,
    loadMediaItems,
    prompt,
    quality,
    quote.crtvaiWei,
    refreshBalance,
    sendOps,
    speed,
    start,
    t,
    walletConfigured,
  ])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border/60 px-3 py-2.5">
        <p className="font-mono text-[10px] tracking-[0.18em] text-primary/85 uppercase">
          {t('flow.eyebrow', { defaultValue: 'Flow' })}
        </p>
        <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
          {t('flow.title', { defaultValue: 'Start → end video' })}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t('flow.blurb', {
            defaultValue:
              'Upload or generate Gemini stills, set duration, pay CRTVAI, then fill the segment.',
          })}
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div className="grid grid-cols-2 gap-2">
          <FrameCard
            label={t('flow.start', { defaultValue: 'Start' })}
            slot={start}
            onMode={(mode) => setStart((s) => ({ ...s, mode }))}
            onPrompt={(generatePrompt) => setStart((s) => ({ ...s, generatePrompt }))}
            onPick={() => fileStartRef.current?.click()}
            fileRef={fileStartRef}
            onFile={(files) => onFile('start', files)}
            disabled={busy}
          />
          <FrameCard
            label={t('flow.end', { defaultValue: 'End' })}
            slot={end}
            onMode={(mode) => setEnd((s) => ({ ...s, mode }))}
            onPrompt={(generatePrompt) => setEnd((s) => ({ ...s, generatePrompt }))}
            onPick={() => fileEndRef.current?.click()}
            fileRef={fileEndRef}
            onFile={(files) => onFile('end', files)}
            disabled={busy}
          />
        </div>

        {lastEndUrl && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 w-full gap-1.5 text-[11px]"
            disabled={busy}
            onClick={continueFromLast}
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            {t('flow.chain.continue', { defaultValue: 'Continue from last end frame' })}
          </Button>
        )}

        <div className="space-y-1.5">
          <Label className="text-[11px]">
            {t('flow.prompt', { defaultValue: 'Motion prompt' })}
          </Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder={t('flow.promptPlaceholder', {
              defaultValue: 'Camera slowly pushes in as light shifts warm…',
            })}
            className="min-h-[72px] resize-none text-[12px]"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[11px]">
              {t('flow.duration', { defaultValue: 'Duration' })}
            </Label>
            <span className="font-mono text-[11px] text-muted-foreground">
              {duration}s ({FLOW_DURATION_MIN_SEC}–{FLOW_DURATION_MAX_SEC})
            </span>
          </div>
          <Slider
            value={[duration]}
            min={FLOW_DURATION_MIN_SEC}
            max={FLOW_DURATION_MAX_SEC}
            step={1}
            disabled={busy}
            onValueChange={([v]) => setDuration(clampFlowDuration(v ?? FLOW_DURATION_DEFAULT_SEC))}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">{t('flow.quality', { defaultValue: 'Quality' })}</Label>
            <Select
              value={quality}
              onValueChange={(v) => setQuality(v as typeof quality)}
              disabled={busy}
            >
              <SelectTrigger className="h-8 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">{t('flow.speed', { defaultValue: 'Speed' })}</Label>
            <Select
              value={speed}
              onValueChange={(v) => setSpeed(v as typeof speed)}
              disabled={busy}
            >
              <SelectTrigger className="h-8 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="fast">Fast</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-2">
          <Label className="text-[11px]" htmlFor="flow-audio">
            {t('flow.audio', { defaultValue: 'Generate audio' })}
          </Label>
          <Switch
            id="flow-audio"
            checked={generateAudio}
            onCheckedChange={setGenerateAudio}
            disabled={busy}
          />
        </div>

        <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-2">
          <Label className="text-[11px]" htmlFor="flow-chain">
            {t('flow.chain.toggle', {
              defaultValue: 'After success, keep end as next start',
            })}
          </Label>
          <Switch
            id="flow-chain"
            checked={chainNext}
            onCheckedChange={setChainNext}
            disabled={busy}
          />
        </div>

        <div className="rounded-xl border border-primary/30 bg-secondary/25 p-3">
          <dl className="space-y-1 font-mono text-[11px]">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Due</dt>
              <dd className="font-semibold">
                {quote.crtvaiDisplay.toFixed(quote.crtvaiDisplay < 1 ? 3 : 2)} CRTVAI
                <span className="ml-1.5 font-normal text-muted-foreground">
                  ({quote.formattedUsd})
                </span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Balance</dt>
              <dd className={cn(insufficient ? 'text-destructive' : 'text-foreground')}>
                {balance.toFixed(2)} CRTVAI
              </dd>
            </div>
            {stillCount > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <dt>Gemini stills</dt>
                <dd>{stillCount}</dd>
              </div>
            )}
          </dl>
          {!canPayOnChain && (
            <p className="mt-2 text-[10px] text-amber-200/90">
              {t('flow.softPay', {
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
              {t('flow.buy', { defaultValue: 'Buy CRTVAI' })}
            </Button>
          )}
        </div>

        {status && (
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">{status}</p>
            {progress > 0 && (
              <div className="h-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, progress)}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border/60 p-3">
        <Button
          type="button"
          className="h-9 w-full gap-1.5 text-[12px]"
          disabled={busy || !prompt.trim()}
          onClick={() => void runFlow()}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <WandSparkles className="h-3.5 w-3.5" />
          )}
          {busy
            ? t('flow.working', { defaultValue: 'Working…' })
            : t('flow.payGenerate', {
                defaultValue: 'Pay {{amount}} CRTVAI & generate',
                amount: quote.crtvaiDisplay.toFixed(quote.crtvaiDisplay < 1 ? 3 : 2),
              })}
        </Button>
      </div>

      <BuyMetokenModal
        open={buyOpen}
        onOpenChange={setBuyOpen}
        initialUsdcAmount={Math.max(1, Math.ceil(quote.estimatedUsdc6 / 1_000_000)).toFixed(2)}
      />
    </div>
  )
})

function FrameCard({
  label,
  slot,
  onMode,
  onPrompt,
  onPick,
  fileRef,
  onFile,
  disabled,
}: {
  label: string
  slot: FrameSlot
  onMode: (mode: 'upload' | 'generate') => void
  onPrompt: (prompt: string) => void
  onPick: () => void
  fileRef: React.RefObject<HTMLInputElement | null>
  onFile: (files: FileList | null) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-border/70 bg-secondary/20 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        <div className="flex gap-0.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onMode('upload')}
            className={cn(
              'rounded px-1.5 py-0.5 text-[9px] uppercase',
              slot.mode === 'upload' ? 'bg-primary/20 text-primary' : 'text-muted-foreground',
            )}
          >
            Upload
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onMode('generate')}
            className={cn(
              'rounded px-1.5 py-0.5 text-[9px] uppercase',
              slot.mode === 'generate' ? 'bg-primary/20 text-primary' : 'text-muted-foreground',
            )}
          >
            Gemini
          </button>
        </div>
      </div>
      {slot.previewUrl ? (
        <img
          src={slot.previewUrl}
          alt=""
          className="mb-1.5 aspect-video w-full rounded object-cover"
        />
      ) : (
        <div className="mb-1.5 flex aspect-video items-center justify-center rounded border border-dashed border-border/80 bg-secondary/30">
          <ImagePlus className="h-5 w-5 text-muted-foreground/60" />
        </div>
      )}
      {slot.mode === 'upload' ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 w-full gap-1 text-[10px]"
          disabled={disabled}
          onClick={onPick}
        >
          <Upload className="h-3 w-3" />
          {t('flow.pickImage', { defaultValue: 'Choose image' })}
        </Button>
      ) : (
        <Textarea
          value={slot.generatePrompt}
          onChange={(e) => onPrompt(e.target.value)}
          disabled={disabled}
          rows={2}
          placeholder={t('flow.stillPrompt', { defaultValue: 'Describe the still…' })}
          className="min-h-[52px] resize-none text-[10px]"
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files)}
      />
      {slot.mode === 'generate' && (
        <p className="mt-1 flex items-center gap-1 text-[9px] text-muted-foreground">
          <Sparkles className="h-2.5 w-2.5" />
          Billed with the Flow invoice
        </p>
      )}
    </div>
  )
}
