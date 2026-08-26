import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BuyMetokenModal } from '@/features/editor/deps/metoken'
import { cn } from '@/shared/ui/cn'
import type { DirectorQuote } from './director-pricing'

export interface PendingDirectorInvoice {
  brief: string
  apiPrompt: string
  audioUri?: string
  quote: DirectorQuote
}

export function DirectorInvoiceCard({
  invoice,
  balance,
  canPayOnChain,
  paying,
  onConfirm,
  onCancel,
  t,
}: {
  invoice: PendingDirectorInvoice
  balance: number
  canPayOnChain: boolean
  paying: boolean
  onConfirm: () => void
  onCancel: () => void
  t: (key: string, opts?: { defaultValue: string; [key: string]: string | number }) => string
}) {
  const { quote } = invoice
  const insufficient = balance < quote.crtvaiDisplay
  const [buyOpen, setBuyOpen] = useState(false)
  const suggestedUsdc = Math.max(1, Math.ceil(quote.estimatedUsdc6 / 1_000_000)).toFixed(2)

  return (
    <div className="rounded-xl border border-primary/35 bg-secondary/30 p-3.5">
      <p className="font-mono text-[10px] tracking-[0.18em] text-primary/85 uppercase">
        {t('director.invoice.eyebrow', { defaultValue: 'Invoice' })}
      </p>
      <h4 className="mt-1 text-[14px] font-semibold tracking-tight text-foreground">
        {t('director.invoice.title', { defaultValue: 'Confirm Director brief' })}
      </h4>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {t('director.invoice.blurb', {
          defaultValue:
            'Charged in CRTVAI from your wallet before generation. Price is per minute of timeline audio.',
        })}
      </p>

      {quote.tier === 'premium' ? (
        <p className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-200/90">
          {t('director.invoice.premium', {
            defaultValue: 'Pro rate — Creative Org / Pixels Premium members save 50% vs retail.',
          })}
        </p>
      ) : (
        <p className="mt-2 rounded-md border border-border/70 bg-secondary/40 px-2 py-1.5 text-[11px] text-muted-foreground">
          {t('director.invoice.proUpsell', {
            defaultValue:
              'Pro tip: Creative Org DAO or Pixels Premium unlocks half-price Director minutes plus cloud research tools.',
          })}
        </p>
      )}

      <dl className="mt-3 space-y-1.5 font-mono text-[11px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Audio</dt>
          <dd className="text-foreground">
            {quote.formattedDuration} ({quote.audioDurationSeconds.toFixed(1)}s ·{' '}
            {quote.billableMinutes.toFixed(2)} min)
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Rate</dt>
          <dd className="text-foreground">
            {(quote.usdc6PerMinute / 1_000_000).toFixed(2)} USD / min
            <span className="ml-1 text-muted-foreground">({quote.tier})</span>
          </dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-border/60 pt-1.5">
          <dt className="text-muted-foreground">Due</dt>
          <dd className="font-semibold text-foreground">
            {quote.crtvaiDisplay.toFixed(quote.crtvaiDisplay < 1 ? 3 : 2)} CRTVAI
            <span className="ml-1.5 font-normal text-muted-foreground">({quote.formattedUsd})</span>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Balance</dt>
          <dd className={cn(insufficient ? 'text-destructive' : 'text-foreground')}>
            {balance.toFixed(2)} CRTVAI
          </dd>
        </div>
      </dl>

      {insufficient && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-destructive">
            {t('director.invoice.insufficient', {
              defaultValue: 'Insufficient CRTVAI. Buy credits, then confirm again.',
            })}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 w-full text-[11px]"
            disabled={paying}
            onClick={() => setBuyOpen(true)}
          >
            {t('director.invoice.buyCrtvai', { defaultValue: 'Buy CRTVAI' })}
          </Button>
        </div>
      )}

      {!canPayOnChain && (
        <p className="mt-2 text-[11px] text-amber-200/90">
          {t('director.invoice.softPay', {
            defaultValue:
              'Treasury not configured — balance is checked, on-chain charge is skipped in this environment.',
          })}
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-[11px]"
          disabled={paying}
          onClick={onCancel}
        >
          {t('director.invoice.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 text-[11px]"
          disabled={paying || insufficient}
          onClick={onConfirm}
        >
          {paying ? (
            <>
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              {t('director.invoice.paying', { defaultValue: 'Paying…' })}
            </>
          ) : (
            t('director.invoice.confirm', {
              defaultValue: 'Pay {{amount}} CRTVAI',
              amount: quote.crtvaiDisplay.toFixed(quote.crtvaiDisplay < 1 ? 3 : 2),
            })
          )}
        </Button>
      </div>

      <BuyMetokenModal open={buyOpen} onOpenChange={setBuyOpen} initialUsdcAmount={suggestedUsdc} />
    </div>
  )
}
