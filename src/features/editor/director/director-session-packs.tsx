import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { BuyMetokenModal } from '@/features/editor/deps/metoken'
import { DIRECTOR_SESSION_PACKS } from '@/config/credits'
import { formatUsdc6 } from '@/features/editor/deps/credits-contract'

/**
 * Optional Director session packs — mint CRTVAI sized for ~N minutes of retail
 * Director audio. Settles via the same Buy CRTVAI curve (not a separate ledger).
 */
export function DirectorSessionPacks() {
  const { t } = useTranslation()
  const [buyOpen, setBuyOpen] = useState(false)
  const [prefillUsdc, setPrefillUsdc] = useState<string | undefined>()

  return (
    <div className="rounded-xl border border-border/70 bg-secondary/20 p-3">
      <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
        {t('director.packs.eyebrow', { defaultValue: 'Session packs' })}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {t('director.packs.blurb', {
          defaultValue:
            'Top up CRTVAI for multiple Director briefs. Packs estimate retail audio minutes; Pro members stretch further.',
        })}
      </p>
      <ul className="mt-2.5 space-y-1.5">
        {DIRECTOR_SESSION_PACKS.map((pack) => (
          <li key={pack.id}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/50"
              onClick={() => {
                setPrefillUsdc((pack.usdc6 / 1_000_000).toFixed(2))
                setBuyOpen(true)
              }}
            >
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-foreground">{pack.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {pack.description}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-primary">
                {formatUsdc6(pack.usdc6)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2 h-7 w-full text-[11px] text-muted-foreground"
        onClick={() => {
          setPrefillUsdc(undefined)
          setBuyOpen(true)
        }}
      >
        {t('director.packs.custom', { defaultValue: 'Custom amount…' })}
      </Button>
      <BuyMetokenModal open={buyOpen} onOpenChange={setBuyOpen} initialUsdcAmount={prefillUsdc} />
    </div>
  )
}
