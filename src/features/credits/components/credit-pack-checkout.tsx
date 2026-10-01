import { useCallback, useMemo, useState } from 'react'
import { Coins, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { getErrorMessage, invalidateWalletTokenBalances } from '@/hooks/invalidate-wallet-balances'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWalletContext } from '@/context/wallet-context'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import { useUsdcBalance } from '@/hooks/use-usdc-balance'
import {
  SETTLEMENT_CREDIT_PACKS,
  usdcDisplayFromCredits,
  type CreditPackDefinition,
} from '@/config/credit-pack-settlement'
import { buildSettlePackOps } from '@/features/credits/api/settle-pack'
import { BuyMetokenModal } from '@/features/credits/deps/metoken'
import { totalUsdcForPurchase } from '@/features/credits/usdc-for-purchase'
import { base } from 'viem/chains'
import { cn } from '@/shared/ui/cn'

/**
 * Fixed-price credit-pack checkout.
 *
 * Each pack is a fixed USDC price → credits (no curve slippage at checkout).
 * Slippage is a fixed internal treasury parameter and is intentionally NOT
 * shown. On success the user's CRTVAI balance is refreshed.
 *
 * Custom amounts open Buy CRTVAI (bonding-curve mint) with USDC prefilled at
 * the retail $0.10/credit display rate.
 */

const BASE_CHAIN_ID = base.id

export function CreditPackCheckout() {
  const { account, chain } = useWalletContext()
  const queryClient = useQueryClient()
  const { sendOps, ready: walletReady } = useSmartWalletOps()
  const { balance: usdcBalance } = useUsdcBalance(chain, account)

  const [settlingId, setSettlingId] = useState<number | null>(null)
  const [customCreditsInput, setCustomCreditsInput] = useState('')
  const [buyOpen, setBuyOpen] = useState(false)
  const [prefillUsdc, setPrefillUsdc] = useState<string | undefined>()

  const onBase = chain?.id === BASE_CHAIN_ID

  const customCredits = useMemo(() => {
    const n = Number(customCreditsInput)
    if (!Number.isFinite(n) || n < 1) return null
    return Math.floor(n)
  }, [customCreditsInput])

  const customUsdcDisplay = customCredits !== null ? usdcDisplayFromCredits(customCredits) : ''

  const handleBuy = useCallback(
    async (pack: CreditPackDefinition) => {
      if (!account || !onBase) return
      setSettlingId(pack.id)
      try {
        const usdc6 = BigInt(pack.usdc6)
        const { ops } = buildSettlePackOps(pack.id, usdc6, account)
        await sendOps(ops)
        toast.success(`Purchased ${pack.credits} credits`)
        invalidateWalletTokenBalances(queryClient, chain?.id, account)
      } catch (error) {
        toast.error(`Purchase failed: ${getErrorMessage(error)}`)
      } finally {
        setSettlingId(null)
      }
    },
    [account, onBase, chain?.id, sendOps, queryClient],
  )

  const handleCustomContinue = useCallback(() => {
    if (!customUsdcDisplay) return
    setPrefillUsdc(customUsdcDisplay)
    setBuyOpen(true)
  }, [customUsdcDisplay])

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {SETTLEMENT_CREDIT_PACKS.map((pack) => (
          <PackCard
            key={pack.id}
            pack={pack}
            chainId={chain?.id}
            onBase={onBase}
            walletReady={walletReady}
            usdcBalance={usdcBalance}
            settling={settlingId === pack.id}
            onBuy={() => handleBuy(pack)}
          />
        ))}
      </div>

      <div className="flex flex-col rounded-xl border border-border/70 bg-secondary/20 p-4">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">Custom</span>
        </div>
        <div className="mt-3 space-y-1.5">
          <label
            htmlFor="custom-credits-input"
            className="text-xs font-medium text-muted-foreground"
          >
            Credits to buy
          </label>
          <Input
            id="custom-credits-input"
            type="number"
            min={1}
            step={1}
            placeholder="e.g. 75"
            value={customCreditsInput}
            onChange={(e) => setCustomCreditsInput(e.target.value)}
          />
        </div>
        {customUsdcDisplay ? (
          <p className="mt-2 text-xs text-muted-foreground">
            About ${customUsdcDisplay} USDC at $0.10/credit — mint via CRTVAI curve (amount may vary
            slightly).
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Enter any credit amount. Continues to Buy CRTVAI (curve mint).
          </p>
        )}
        <Button
          type="button"
          className="mt-3 w-full"
          disabled={!customUsdcDisplay}
          onClick={handleCustomContinue}
        >
          {customUsdcDisplay ? `Continue with $${customUsdcDisplay} USDC` : 'Continue'}
        </Button>
      </div>

      <BuyMetokenModal open={buyOpen} onOpenChange={setBuyOpen} initialUsdcAmount={prefillUsdc} />
    </div>
  )
}

function PackCard({
  pack,
  chainId,
  onBase,
  walletReady,
  usdcBalance,
  settling,
  onBuy,
}: {
  pack: CreditPackDefinition
  chainId: number | undefined
  onBase: boolean
  walletReady: boolean
  usdcBalance: string | null
  settling: boolean
  onBuy: () => void
}) {
  const priceUsd = (pack.usdc6 / 1_000_000).toFixed(0)

  const insufficient = useMemo(() => {
    if (usdcBalance === null || !chainId) return false
    const requiredUsd = totalUsdcForPurchase(pack.usdc6, chainId) / 1_000_000
    return Number(usdcBalance) < requiredUsd
  }, [usdcBalance, pack.usdc6, chainId])

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
