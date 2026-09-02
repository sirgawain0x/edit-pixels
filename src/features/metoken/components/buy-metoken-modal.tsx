import { useCallback, useEffect, useMemo, useState } from 'react'
import { Coins, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { parseUnits, formatUnits, erc20Abi } from 'viem'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useWalletContext } from '@/context/wallet-context'
import { useSmartWalletOps } from '@/hooks/use-smart-wallet-ops'
import { useUsdcBalance } from '@/hooks/use-usdc-balance'
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance'
import {
  CRTVAI_DECIMALS,
  USDC_BASE_ADDRESS,
  USDC_DECIMALS,
  readCrtvaiCurrentPrice,
  readCrtvaiMintQuote,
} from '@/config/metoken'
import { buildBuyMetokenOps } from '@/features/metoken/api/buy-metoken'
import { totalUsdcForPurchase } from '@/features/credits/usdc-for-purchase'
import { getBasePublicClient } from '@/config/base-client'
import { base } from 'viem/chains'
import { cn } from '@/shared/ui/cn'

interface BuyMetokenModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Prefill USDC amount when opening (e.g. Director session packs). */
  initialUsdcAmount?: string
}

const BASE_CHAIN_ID = base.id

export function BuyMetokenModal({ open, onOpenChange, initialUsdcAmount }: BuyMetokenModalProps) {
  const { account, signerAddress, chain, walletClient } = useWalletContext()
  const queryClient = useQueryClient()
  const { sendOps, ready: walletReady } = useSmartWalletOps()
  const { balance: usdcBalance, formatted: usdcFormatted } = useUsdcBalance(chain, account)
  const { balance: signerUsdcBalance } = useUsdcBalance(chain, signerAddress)
  const { formatted: crtvaiFormatted, symbol } = useCrtvaiBalance(account)

  const [usdcInput, setUsdcInput] = useState('')
  const [estimatedOutput, setEstimatedOutput] = useState<string | null>(null)
  const [currentPrice, setCurrentPrice] = useState<string | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [minting, setMinting] = useState(false)
  const [transferring, setTransferring] = useState(false)

  const onBase = chain?.id === BASE_CHAIN_ID

  const requiredUsdc6 = useMemo(() => {
    if (!usdcInput || !onBase || !chain?.id) return 0
    try {
      const inputUsdc6 = Number(parseUnits(usdcInput, USDC_DECIMALS))
      return totalUsdcForPurchase(inputUsdc6, chain.id)
    } catch {
      return 0
    }
  }, [usdcInput, onBase, chain?.id])

  const hasSufficientUsdc = useMemo(() => {
    if (!usdcInput || !usdcBalance || requiredUsdc6 === 0) return true
    try {
      const balanceRaw = parseUnits(usdcBalance, USDC_DECIMALS)
      return BigInt(requiredUsdc6) <= balanceRaw
    } catch {
      return false
    }
  }, [usdcInput, usdcBalance, requiredUsdc6])

  const needsEoaTransfer = useMemo(() => {
    if (!signerUsdcBalance || !usdcBalance || requiredUsdc6 === 0) return false
    try {
      const smartRaw = parseUnits(usdcBalance, USDC_DECIMALS)
      const eoaRaw = parseUnits(signerUsdcBalance, USDC_DECIMALS)
      return smartRaw < BigInt(requiredUsdc6) && eoaRaw > 0n
    } catch {
      return false
    }
  }, [signerUsdcBalance, usdcBalance, requiredUsdc6])

  // Prefill + fetch current price on open
  useEffect(() => {
    if (!open) return
    if (initialUsdcAmount) setUsdcInput(initialUsdcAmount)
    if (!onBase) return
    let cancelled = false
    void (async () => {
      try {
        const price = await readCrtvaiCurrentPrice()
        if (!cancelled) {
          setCurrentPrice(formatUnits(price, USDC_DECIMALS))
        }
      } catch {
        // Price read failed — non-fatal, UI still works
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, onBase, initialUsdcAmount])

  // Debounced mint quote
  useEffect(() => {
    if (!open || !onBase || !usdcInput) {
      setEstimatedOutput(null)
      return
    }
    let usdcRaw: bigint
    try {
      usdcRaw = parseUnits(usdcInput, USDC_DECIMALS)
    } catch {
      setEstimatedOutput(null)
      return
    }
    if (usdcRaw <= 0n) {
      setEstimatedOutput(null)
      return
    }
    let cancelled = false
    setQuoting(true)
    const timer = window.setTimeout(async () => {
      try {
        const quote = await readCrtvaiMintQuote(usdcRaw)
        if (!cancelled) {
          setEstimatedOutput(formatUnits(quote, CRTVAI_DECIMALS))
        }
      } catch {
        if (!cancelled) setEstimatedOutput(null)
      } finally {
        if (!cancelled) setQuoting(false)
      }
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (!cancelled) setQuoting(false)
    }
  }, [open, onBase, usdcInput])

  const handleMoveUsdcToSmartWallet = useCallback(async () => {
    if (!walletClient || !account || !signerAddress || !signerUsdcBalance) return
    let eoaRaw: bigint
    let smartRaw: bigint
    try {
      eoaRaw = parseUnits(signerUsdcBalance, USDC_DECIMALS)
      smartRaw = parseUnits(usdcBalance ?? '0', USDC_DECIMALS)
    } catch {
      toast.error('Invalid USDC balance')
      return
    }
    const shortfall = BigInt(requiredUsdc6) > smartRaw ? BigInt(requiredUsdc6) - smartRaw : 0n
    const amount = shortfall > 0n && shortfall < eoaRaw ? shortfall : eoaRaw
    if (amount <= 0n) return

    setTransferring(true)
    try {
      const hash = await walletClient.writeContract({
        address: USDC_BASE_ADDRESS,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [account, amount],
        chain,
        account: signerAddress,
      })
      await getBasePublicClient().waitForTransactionReceipt({ hash })
      toast.success('USDC moved to smart wallet')
      void queryClient.invalidateQueries({ queryKey: ['usdc-balance', chain?.id, account] })
      void queryClient.invalidateQueries({ queryKey: ['usdc-balance', chain?.id, signerAddress] })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`Transfer failed: ${msg}`)
    } finally {
      setTransferring(false)
    }
  }, [
    walletClient,
    account,
    signerAddress,
    signerUsdcBalance,
    usdcBalance,
    requiredUsdc6,
    chain,
    queryClient,
  ])

  const handleMint = useCallback(async () => {
    if (!account || !usdcInput || !onBase) return
    let usdcRaw: bigint
    try {
      usdcRaw = parseUnits(usdcInput, USDC_DECIMALS)
    } catch {
      toast.error('Invalid USDC amount')
      return
    }
    if (usdcRaw <= 0n) {
      toast.error('Amount must be greater than 0')
      return
    }
    setMinting(true)
    try {
      const { ops } = buildBuyMetokenOps(usdcRaw, account)
      await sendOps(ops)
      toast.success(`Minted CRTVAI with ${usdcInput} USDC`)
      setUsdcInput('')
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['usdc-balance', chain?.id, account] })
      void queryClient.invalidateQueries({ queryKey: ['crtvai-balance', account] })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`Mint failed: ${msg}`)
    } finally {
      setMinting(false)
    }
  }, [account, usdcInput, onBase, chain?.id, sendOps, onOpenChange, queryClient])

  const canMint =
    onBase && walletReady && usdcInput && hasSufficientUsdc && !quoting && !minting && !transferring

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" aria-hidden />
            Buy CRTVAI
          </DialogTitle>
          <DialogDescription>
            Mint CRTVAI by depositing USDC into the meToken bonding curve on Base.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Wallet USDC:</span>
            <span className="font-medium">{usdcFormatted} USDC</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Wallet {symbol}:</span>
            <span className="font-medium">
              {crtvaiFormatted} {symbol}
            </span>
          </div>
          {currentPrice && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Current price:</span>
              <span className="font-medium">
                {Number(currentPrice).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC/
                {symbol}
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="usdc-input" className="text-sm font-medium">
              USDC to spend
            </label>
            <Input
              id="usdc-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={usdcInput}
              onChange={(e) => setUsdcInput(e.target.value)}
              disabled={minting}
            />
          </div>

          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Estimated receive: </span>
            <span className="font-medium">
              {quoting ? (
                <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
              ) : estimatedOutput ? (
                `${Number(estimatedOutput).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`
              ) : (
                '—'
              )}
            </span>
          </div>

          {!onBase && (
            <p className="text-xs text-amber-500">Switch to Base network to mint CRTVAI.</p>
          )}
          {!hasSufficientUsdc && usdcInput && !needsEoaTransfer && (
            <p className="text-xs text-destructive">
              Insufficient USDC balance (includes gas reserve).
            </p>
          )}
          {needsEoaTransfer && (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <p>USDC is in your signer wallet. Move it to your smart wallet before minting.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={transferring || minting}
                onClick={() => void handleMoveUsdcToSmartWallet()}
              >
                {transferring ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Moving USDC…
                  </>
                ) : (
                  'Move USDC to smart wallet'
                )}
              </Button>
            </div>
          )}

          <Button
            onClick={handleMint}
            disabled={!canMint}
            className={cn('w-full', minting && 'opacity-80')}
          >
            {minting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Minting…
              </>
            ) : (
              'Mint CRTVAI'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
