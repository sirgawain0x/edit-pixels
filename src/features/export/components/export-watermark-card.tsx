/**
 * Watermark status + per-project removal, shown inside the export dialog.
 *
 * The card has three jobs and no others: say truthfully whether this export will be stamped,
 * sell the removal for *this project* when it is not, and — once paid — let the user put the
 * mark back without paying again. It never decides the render flag itself; the dialog owns
 * `settings.watermark` and this component only calls `onStampChange`.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, BadgeCheck, Loader2, Stamp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { ExportUnlockStatus } from '../hooks/use-export-unlock'

export interface ExportWatermarkCardProps {
  status: ExportUnlockStatus
  unlocked: boolean
  /** Whether the mark will actually be drawn on this export. */
  stamped: boolean
  priceUsd: number | null
  crtvaiCost: string | null
  balanceFormatted: string
  blockedReason: 'no-wallet' | 'insufficient' | null
  error: string | null
  expiresAtMs: number | null
  /** A transfer has left the wallet; retrying must resume the claim, not pay again. */
  hasPendingPayment: boolean
  onPay: () => void
  onRetry: () => void
  onStampChange: (stamped: boolean) => void
}

const BUSY: ExportUnlockStatus[] = ['paying', 'verifying']

function formatExpiry(expiresAtMs: number): string {
  return new Date(expiresAtMs).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

type Translator = ReturnType<typeof useTranslation>['t']

/** Why the pay button is unavailable, in the user's words. */
function blockedMessage(
  t: Translator,
  blockedReason: 'no-wallet' | 'insufficient' | null,
  error: string | null,
): string | null {
  if (blockedReason === 'no-wallet') return t('export.watermark.noWallet')
  if (blockedReason === 'insufficient') return t('export.watermark.insufficient')
  return error
}

function ConfirmRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono font-medium">{children}</dd>
    </div>
  )
}

function WatermarkPayDialog({
  open,
  onOpenChange,
  status,
  priceUsd,
  crtvaiCost,
  balanceFormatted,
  blockedReason,
  error,
  onPay,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: ExportUnlockStatus
  priceUsd: number | null
  crtvaiCost: string | null
  balanceFormatted: string
  blockedReason: 'no-wallet' | 'insufficient' | null
  error: string | null
  onPay: () => void
}) {
  const { t } = useTranslation()
  const busy = BUSY.includes(status)
  const message = blockedMessage(t, blockedReason, error)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('export.watermark.confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('export.watermark.confirmBody')}</AlertDialogDescription>
        </AlertDialogHeader>

        <dl className="space-y-2 text-sm">
          <ConfirmRow label={t('export.watermark.confirmPrice')}>
            {priceUsd !== null ? `$${priceUsd.toFixed(2)}` : '—'}
          </ConfirmRow>
          <ConfirmRow label={t('export.watermark.confirmCost')}>
            {crtvaiCost ?? '—'} {t('export.watermark.unit')}
          </ConfirmRow>
          <ConfirmRow label={t('export.watermark.confirmBalance')}>{balanceFormatted}</ConfirmRow>
        </dl>

        {message && (
          <p className="flex items-start gap-1.5 text-xs text-amber-500">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{message}</span>
          </p>
        )}

        {busy && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {status === 'paying' ? t('export.watermark.paying') : t('export.watermark.verifying')}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || blockedReason !== null || crtvaiCost === null}
            onClick={(event) => {
              // Stay open while the wallet and the server work; closing here would hide the
              // only place the progress is reported.
              event.preventDefault()
              onPay()
            }}
          >
            {t('export.watermark.confirmPay', { crtvai: crtvaiCost ?? '—' })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The paid state: nothing to buy, only a choice about whether to stamp this export. */
function UnlockedWatermark({
  stamped,
  expiresAtMs,
  onStampChange,
}: {
  stamped: boolean
  expiresAtMs: number | null
  onStampChange: (stamped: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-green-500" />
          <span className="text-sm font-medium">{t('export.watermark.unlockedTitle')}</span>
        </div>
        <Switch
          id="export-watermark-stamp"
          checked={stamped}
          onCheckedChange={onStampChange}
          aria-label={t('export.watermark.stampAnyway')}
        />
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {expiresAtMs
          ? t('export.watermark.unlockedBody', { date: formatExpiry(expiresAtMs) })
          : t('export.watermark.unlockedBodyNoDate')}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {stamped ? t('export.watermark.stampedHint') : t('export.watermark.stampAnywayHint')}
      </p>
    </div>
  )
}

export function ExportWatermarkCard(props: ExportWatermarkCardProps) {
  const { t } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (props.unlocked) {
    return (
      <UnlockedWatermark
        stamped={props.stamped}
        expiresAtMs={props.expiresAtMs}
        onStampChange={props.onStampChange}
      />
    )
  }

  const { status, priceUsd, crtvaiCost, error, hasPendingPayment } = props
  const quoting = status === 'quoting'
  const failed = status === 'error'

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Stamp className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t('export.watermark.lockedTitle')}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('export.watermark.lockedBody')}
          </p>
        </div>

        {quoting && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('export.watermark.quoting')}
          </span>
        )}

        {failed && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            // With a transfer already sent, the only useful retry is the claim itself.
            onClick={hasPendingPayment ? props.onPay : props.onRetry}
          >
            {hasPendingPayment ? t('export.watermark.finish') : t('export.watermark.retry')}
          </Button>
        )}

        {!quoting && !failed && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => setConfirmOpen(true)}
          >
            {priceUsd !== null
              ? t('export.watermark.buy', { price: priceUsd.toFixed(2) })
              : t('export.watermark.buyNoPrice')}
          </Button>
        )}
      </div>

      {failed && error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span>{error}</span>
        </p>
      )}

      {status === 'locked' && crtvaiCost !== null && (
        <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
          {t('export.watermark.costHint', { crtvai: crtvaiCost })}
        </p>
      )}

      <WatermarkPayDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        status={status}
        priceUsd={priceUsd}
        crtvaiCost={crtvaiCost}
        balanceFormatted={props.balanceFormatted}
        blockedReason={props.blockedReason}
        error={error}
        onPay={props.onPay}
      />
    </div>
  )
}
