import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Loader2, Square } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/shared/ui/cn'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { getMediaTranscriptionModelOptions } from '../transcription/registry'
import { isCloudTranscriptionModel, isParakeetModel } from '../transcription/transcription-engine'
import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage'

export interface TranscribeDialogValues {
  model: MediaTranscriptModel
  quantization: MediaTranscriptQuantization
  language: string
  /** Cloud-only glossary / speech adaptation terms. */
  glossary?: string
}

interface TranscribeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileName: string
  hasTranscript: boolean
  isRunning: boolean
  progressPercent: number | null
  progressIndeterminate?: boolean
  progressLabel: string
  progressDetail?: string | null
  errorMessage?: string | null
  /** Source audio duration in seconds, used for the Precision estimate. */
  sourceDurationSec?: number
  /** Current CRTVAI balance, in the token's smallest unit. Used for the Precision quote gate. */
  crtvaiBalance?: number
  /** Number of free short Precision runs already used this month. */
  freePrecisionRunsUsed?: number
  onStart: (values: TranscribeDialogValues) => void
  onCancel: () => void
}

const PRECISION_RATE_PER_MIN = 0.0099
const PRECISION_CAP_USD = 4.752
const HARD_CAP_MIN = 480
const FREE_PRECISION_RUNS_MONTHLY = 5
/** Source length that still counts as a "short run" and can use a free allowance. */
const FREE_SHORT_RUN_MAX_MIN = 10

interface ModelRow {
  id: MediaTranscriptModel
  title: string
  desc: string
  meta: string
  badge: string
  badgeVariant: 'default' | 'free' | 'paid'
}

function buildModelRows(t: TFunction): ModelRow[] {
  return [
    {
      id: 'parakeet-tdt-v3',
      title: t('media.transcribe.parakeetTitle', { defaultValue: 'Parakeet TDT 0.6B v3' }),
      desc: t('media.transcribe.parakeetDesc', {
        defaultValue:
          'Runs in your browser. Best English accuracy of the local tiers; 25 EU languages.',
      }),
      meta: t('media.transcribe.parakeetMeta', { defaultValue: '~1.3 GB · instant' }),
      badge: t('media.transcribe.defaultBadge', { defaultValue: 'Default' }),
      badgeVariant: 'default',
    },
    {
      id: 'whisper-large',
      title: t('media.transcribe.whisperTitle', { defaultValue: 'Whisper Large v3 Turbo' }),
      desc: t('media.transcribe.whisperDesc', {
        defaultValue:
          'Runs in your browser. 99 languages; slower, but covers Japanese, Korean, and Chinese better.',
      }),
      meta: t('media.transcribe.whisperMeta', { defaultValue: '~2.6 GB · slower' }),
      badge: t('media.transcribe.freeBadge', { defaultValue: 'Free' }),
      badgeVariant: 'free',
    },
    {
      id: 'chirp-3',
      title: t('media.transcribe.precisionTitle', { defaultValue: 'Precision (Google Chirp 3)' }),
      desc: t('media.transcribe.precisionDesc', {
        defaultValue:
          'Cloud batch transcription. Cut-ready word timings, speech adaptation, 14 locales. Ready in a few minutes.',
      }),
      meta: t('media.transcribe.precisionMeta', { defaultValue: 'No download · ~2 min' }),
      badge: t('media.transcribe.paidBadge', {
        // Interpolated from the constants: hardcoding the rate here is how the
        // dialog ends up advertising a price the route does not charge.
        defaultValue: `$${PRECISION_RATE_PER_MIN}/min · max $${PRECISION_CAP_USD.toFixed(2)}`,
      }),
      badgeVariant: 'paid',
    },
  ]
}

interface CostEstimate {
  priceUsd: number
  label: string
}

/** What the run will cost, which depends on tier, source length, and the free allowance. */
function estimatePrecisionCost(input: {
  isPrecision: boolean
  sourceMinutes: number
  freeRunsUsed: number
  t: TFunction
}): CostEstimate {
  const { isPrecision, sourceMinutes, freeRunsUsed, t } = input
  if (!isPrecision) {
    return {
      priceUsd: 0,
      label: t('media.transcribe.freeLocalRun', { defaultValue: 'Local run (free)' }),
    }
  }

  if (sourceMinutes > FREE_SHORT_RUN_MAX_MIN) {
    const raw = sourceMinutes * PRECISION_RATE_PER_MIN
    return {
      priceUsd: Math.min(raw, PRECISION_CAP_USD),
      label: t('media.transcribe.precisionEstimate', {
        defaultValue: `$0.00 — up to $${PRECISION_CAP_USD.toFixed(2)} max`,
      }),
    }
  }

  const freeLeft = Math.max(0, FREE_PRECISION_RUNS_MONTHLY - freeRunsUsed)
  if (freeLeft > 0) {
    return {
      priceUsd: 0,
      label: t('media.transcribe.freeShortRun', {
        count: freeLeft,
        defaultValue: `Free for the first ${FREE_PRECISION_RUNS_MONTHLY} short runs ({{count}} left)`,
      }),
    }
  }
  return {
    priceUsd: sourceMinutes * PRECISION_RATE_PER_MIN,
    label: t('media.transcribe.shortRun', { defaultValue: 'Short run' }),
  }
}

function DialogAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      {children}
    </div>
  )
}

function ModelOptionRow({
  row,
  selected,
  disabled,
  onSelect,
}: {
  row: ModelRow
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <div
      onClick={() => !disabled && onSelect()}
      className={cn(
        'grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border p-3 transition-colors',
        selected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <div
        className={cn(
          'flex h-[18px] w-[18px] items-center justify-center rounded-full border-2',
          selected ? 'border-primary' : 'border-muted-foreground',
        )}
      >
        {selected && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
      </div>
      <div className="min-w-0">
        <div className="font-semibold text-sm">
          {row.title}
          <span
            className={cn(
              'ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
              row.badgeVariant === 'default' && 'bg-green-500/15 text-green-600',
              row.badgeVariant === 'free' && 'bg-purple-500/15 text-purple-400',
              row.badgeVariant === 'paid' && 'bg-yellow-500/15 text-yellow-500',
            )}
          >
            {row.badge}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{row.desc}</p>
      </div>
      <div className="text-right text-xs text-muted-foreground whitespace-nowrap">{row.meta}</div>
    </div>
  )
}

function GlossaryField({
  value,
  onChange,
  disabled,
  t,
}: {
  value: string
  onChange: (next: string) => void
  disabled: boolean
  t: TFunction
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="transcribe-glossary" className="text-sm">
        {t('media.transcribe.glossaryLabel', { defaultValue: 'Names & glossary' })}
      </Label>
      <Textarea
        id="transcribe-glossary"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('media.transcribe.glossaryPlaceholder', {
          defaultValue: 'Sir Gawain, Creative TV, CRTVAI, Lovelace, Base, 26 million, 3.5%',
        })}
        disabled={disabled}
        className="min-h-[88px] resize-y"
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('media.transcribe.glossaryHint', {
          defaultValue:
            "One term per line. Google's output normalizes numbers (e.g. '3.5%'), so include those forms too. Editing this list is free and doesn't re-run the transcription.",
        })}
      </p>
    </div>
  )
}

function EstimatePanel({
  estimate,
  isPrecision,
  sourceMinutes,
  sourceDurationSec,
  t,
}: {
  estimate: CostEstimate
  isPrecision: boolean
  sourceMinutes: number
  sourceDurationSec: number
  t: TFunction
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-secondary/40 p-3">
      <div className="flex items-baseline gap-2">
        <div
          className={cn(
            'text-2xl font-bold',
            estimate.priceUsd === 0 ? 'text-green-500' : 'text-foreground',
          )}
        >
          {estimate.priceUsd === 0
            ? t('media.transcribe.freeLabel', { defaultValue: 'Free' })
            : `$${estimate.priceUsd.toFixed(2)}`}
        </div>
        <div className="text-sm text-muted-foreground">{estimate.label}</div>
      </div>
      {sourceDurationSec > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('media.transcribe.sourceDuration', {
            defaultValue: `Source: ${Math.round(sourceMinutes)} min`,
          })}
        </p>
      )}
      {isPrecision && estimate.priceUsd > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('media.transcribe.quoteWillBeIssued', {
            defaultValue: 'A CRTVAI quote will be issued when you click Start.',
          })}
        </p>
      )}
    </div>
  )
}

/** ARIA bounds for the bar: an indeterminate run reports no numbers at all. */
function progressBarAria(indeterminate: boolean, percent: number | null) {
  if (indeterminate) return {}
  return { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent ?? undefined }
}

function progressBarStyle(indeterminate: boolean, percent: number | null) {
  if (indeterminate || percent === null) return undefined
  return { width: `${percent}%` }
}

function ProgressBar({
  indeterminate,
  percent,
  label,
}: {
  indeterminate: boolean
  percent: number | null
  label: string
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      {...progressBarAria(indeterminate, percent)}
      className="h-1 overflow-hidden rounded-full bg-secondary"
    >
      <div
        className={cn(
          'h-full rounded-full bg-blue-500 transition-all duration-300',
          indeterminate && 'w-1/3 animate-pulse',
        )}
        style={progressBarStyle(indeterminate, percent)}
      />
    </div>
  )
}

function ProgressPanel({
  progressLabel,
  progressPercent,
  progressIndeterminate,
  progressDetail,
  t,
}: {
  progressLabel: string
  progressPercent: number | null
  progressIndeterminate: boolean
  progressDetail: string | null
  t: TFunction
}) {
  // An indeterminate run has a pulse bar and no percentage. A null percent with no
  // indeterminate flag means the count is simply not known yet: no bar either.
  const showPercent = !progressIndeterminate && progressPercent !== null
  const showBar = progressIndeterminate || progressPercent !== null

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-secondary/40 px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="truncate">{progressLabel}</span>
        {showPercent && (
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
            {progressPercent}%
          </span>
        )}
      </div>
      {showBar && (
        <ProgressBar
          indeterminate={progressIndeterminate}
          percent={progressPercent}
          label={t('media.transcribe.progressAria')}
        />
      )}
      {progressDetail && (
        <div className="text-xs text-muted-foreground tabular-nums">{progressDetail}</div>
      )}
    </div>
  )
}

export function TranscribeDialog({
  open,
  onOpenChange,
  fileName,
  hasTranscript,
  isRunning,
  progressPercent,
  progressIndeterminate = false,
  progressLabel,
  progressDetail = null,
  errorMessage,
  sourceDurationSec = 0,
  crtvaiBalance = 0,
  freePrecisionRunsUsed = 0,
  onStart,
  onCancel,
}: TranscribeDialogProps) {
  const { t } = useTranslation()
  const clearMediaSkimPreview = useEditorStore((s) => s.clearMediaSkimPreview)
  const clearCompoundClipSkimPreview = useEditorStore((s) => s.clearCompoundClipSkimPreview)
  const beginTranscriptionDialog = useEditorStore((s) => s.beginTranscriptionDialog)
  const endTranscriptionDialog = useEditorStore((s) => s.endTranscriptionDialog)

  const modelOptions = useMemo(() => getMediaTranscriptionModelOptions(), [])
  const defaultModel = (modelOptions[0]?.value as MediaTranscriptModel) ?? 'parakeet-tdt-v3'

  const [model, setModel] = useState<MediaTranscriptModel>(defaultModel)
  const [glossary, setGlossary] = useState('')

  useEffect(() => {
    if (!open) return
    setModel(defaultModel)
    setGlossary('')
  }, [open, defaultModel])

  useEffect(() => {
    if (!open) return
    beginTranscriptionDialog()
    clearMediaSkimPreview()
    clearCompoundClipSkimPreview()
    usePlaybackStore.getState().setPreviewFrame(null)
    usePlaybackStore.getState().pause()

    return () => {
      endTranscriptionDialog()
    }
  }, [
    beginTranscriptionDialog,
    clearCompoundClipSkimPreview,
    clearMediaSkimPreview,
    endTranscriptionDialog,
    open,
  ])

  const sourceMinutes = sourceDurationSec / 60
  const isPrecision = isCloudTranscriptionModel(model)

  const estimate = useMemo(
    () =>
      estimatePrecisionCost({
        isPrecision,
        sourceMinutes,
        freeRunsUsed: freePrecisionRunsUsed,
        t,
      }),
    [isPrecision, sourceMinutes, freePrecisionRunsUsed, t],
  )

  const overCap = sourceMinutes > HARD_CAP_MIN
  const enoughBalance = estimate.priceUsd === 0 || crtvaiBalance > 0
  const rows = useMemo(() => buildModelRows(t), [t])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (isRunning && !nextOpen) return
      onOpenChange(nextOpen)
    },
    [isRunning, onOpenChange],
  )

  const handleStart = () => {
    onStart({
      model,
      quantization: 'fp16',
      language: isParakeetModel(model) ? '' : '',
      glossary,
    })
  }

  const title = hasTranscript
    ? t('media.transcribe.refreshTitle')
    : t('media.transcribe.generateTitle')
  const startLabel =
    isPrecision && estimate.priceUsd > 0
      ? t('media.transcribe.getQuote', { defaultValue: 'Get CRTVAI quote' })
      : t('media.transcribe.start')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal>
      <DialogContent
        className="sm:max-w-lg"
        hideCloseButton={isRunning}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (isRunning) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="truncate">{fileName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            {rows.map((row) => (
              <ModelOptionRow
                key={row.id}
                row={row}
                selected={model === row.id}
                disabled={isRunning}
                onSelect={() => setModel(row.id)}
              />
            ))}
          </div>

          {isPrecision && (
            <GlossaryField value={glossary} onChange={setGlossary} disabled={isRunning} t={t} />
          )}

          <EstimatePanel
            estimate={estimate}
            isPrecision={isPrecision}
            sourceMinutes={sourceMinutes}
            sourceDurationSec={sourceDurationSec}
            t={t}
          />

          {overCap && (
            <DialogAlert>
              {t('media.transcribe.overCap', {
                defaultValue:
                  'This run exceeds the 8-hour hard cap. Trim or split the audio first.',
              })}
            </DialogAlert>
          )}

          {!enoughBalance && isPrecision && estimate.priceUsd > 0 && (
            <DialogAlert>
              {t('media.transcribe.notEnoughBalance', {
                defaultValue: 'Not enough CRTVAI. Add credits to start.',
              })}
            </DialogAlert>
          )}

          {errorMessage && !isRunning && <DialogAlert>{errorMessage}</DialogAlert>}

          {isRunning && (
            <ProgressPanel
              progressLabel={progressLabel}
              progressPercent={progressPercent}
              progressIndeterminate={progressIndeterminate}
              progressDetail={progressDetail}
              t={t}
            />
          )}
        </div>

        <DialogFooter>
          {isRunning ? (
            <Button variant="destructive" onClick={onCancel}>
              <Square className="mr-1.5 h-3.5 w-3.5" />
              {t('media.transcribe.stop')}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleStart} disabled={overCap || !enoughBalance}>
                {startLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
