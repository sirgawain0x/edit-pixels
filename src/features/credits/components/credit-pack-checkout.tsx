import { useCallback, useMemo, useState } from 'react'
import { Coins, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useWalletContext } from '@/context/wallet-context'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import { useUsdcBalance } from '@/hooks/use-usdc-balance'
import { SETTLEMENT_CREDIT_PACKS, type CreditPackDefinition } from '@/config/credit-pack-settlement'
import { buildSettlePackOps } from '@/features/credits/api/settle-pack'
import { base } from 'viem/chains'
import { cn } from '@/shared/ui/cn'

/**
 * Fixed-price credit-pack checkout.
 *
 * Each pack is a fixed USDC price → credits (no curve slippage at checkout).
 * Slippage is a fixed internal treasury parameter and is intentionally NOT
 * shown. On success the user's CRTVAI balance is refreshed.
 */

const BASE_CHAIN_ID = base.id

export function CreditPackCheckout() {
  const { account, chain } = useWalletContext()
  const queryClient = useQueryClient()
  const { sendOps, ready: walletReady } = useSmartWalletOps()
  const { balance: usdcBalance } = useUsdcBalance(chain, account)

  const [settlingId, setSettlingId] = useState<number | null>(null)

  const onBase = chain?.id === BASE_CHAIN_ID

  const handleBuy = useCallback(
    async (pack: CreditPackDefinition) => {
      if (!account || !onBase) return
      setSettlingId(pack.id)
      try {
        const usdc6 = BigInt(pack.usdc6)
        const { ops } = buildSettlePackOps(pack.id, usdc6, account)
        await sendOps(ops)
        toast.success(`Purchased ${pack.credits} credits`)
        void queryClient.invalidateQueries({ queryKey: ['usdc-balance', chain?.id, account] })
        void queryClient.invalidateQueries({ queryKey: ['crtvai-balance', account] })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        toast.error(`Purchase failed: ${msg}`)
      } finally {
        setSettlingId(null)
      }
    },
    [account, onBase, chain?.id, sendOps, queryClient],
  )

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {SETTLEMENT_CREDIT_PACKS.map((pack) => (
        <PackCard
          key={pack.id}
          pack={pack}
          onBase={onBase}
          walletReady={walletReady}
          usdcBalance={usdcBalance}
          settling={settlingId === pack.id}
          onBuy={() => handleBuy(pack)}
        />
      ))}
    </div>
  )
}

function PackCard({
  pack,
  onBase,
  walletReady,
  usdcBalance,
  settling,
  onBuy,
}: {
  pack: CreditPackDefinition
  onBase: boolean
  walletReady: boolean
  usdcBalance: string | null
  settling: boolean
  onBuy: () => void
}) {
  const priceUsd = (pack.usdc6 / 1_000_000).toFixed(0)

  const insufficient = useMemo(() => {
    if (usdcBalance === null) return false
    return Number(usdcBalance) < pack.usdc6 / 1_000_000
  }, [usdcBalance, pack.usdc6])

  const disabled = !onBase || !walletReady || settling || insufficient

  return (
    <div className="flex flex-col rounded-xl border border-border/70 bg-secondary/20 p-4">
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">{pack.name}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-2xl font-semibold">${priceUsd}</span>
        <span className="text-xs text-muted-foreground">USDC</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{pack.description}</p>

      {!onBase && <p className="mt-2 text-[11px] text-amber-500">Switch to Base to buy.</p>}
      {insufficient && (
        <p className="mt-2 text-[11px] text-destructive">Insufficient USDC balance.</p>
      )}

      <Button
        onClick={onBuy}
        disabled={disabled}
        className={cn('mt-3 w-full', settling && 'opacity-80')}
      >
        {settling ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Purchasing…
          </>
        ) : (
          `Buy ${pack.credits} credits`
        )}
      </Button>
    </div>
  )
}
