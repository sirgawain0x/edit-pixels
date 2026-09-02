import { Coins, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useBuyMetokenForm } from '@/features/metoken/hooks/use-buy-metoken-form'
import { cn } from '@/shared/ui/cn'

interface BuyMetokenModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Prefill USDC amount when opening (e.g. Director session packs). */
  initialUsdcAmount?: string
}

export function BuyMetokenModal({ open, onOpenChange, initialUsdcAmount }: BuyMetokenModalProps) {
  const form = useBuyMetokenForm(open, onOpenChange, initialUsdcAmount)

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
            <span className="font-medium">{form.usdcFormatted} USDC</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Wallet {form.symbol}:</span>
            <span className="font-medium">
              {form.crtvaiFormatted} {form.symbol}
            </span>
          </div>
          {form.currentPrice && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Current price:</span>
              <span className="font-medium">
                {Number(form.currentPrice).toLocaleString(undefined, { maximumFractionDigits: 6 })}{' '}
                USDC/{form.symbol}
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
              value={form.usdcInput}
              onChange={(e) => form.setUsdcInput(e.target.value)}
              disabled={form.minting}
            />
          </div>

          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Estimated receive: </span>
            <span className="font-medium">
              {form.quoting ? (
                <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
              ) : form.estimatedOutput ? (
                `${Number(form.estimatedOutput).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${form.symbol}`
              ) : (
                '—'
              )}
            </span>
          </div>

          {!form.onBase && (
            <p className="text-xs text-amber-500">Switch to Base network to mint CRTVAI.</p>
          )}
          {!form.hasSufficientUsdc && form.usdcInput && !form.needsEoaTransfer && (
            <p className="text-xs text-destructive">
              Insufficient USDC balance (includes gas reserve).
            </p>
          )}
          {form.needsEoaTransfer && (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <p>USDC is in your signer wallet. Move it to your smart wallet before minting.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={form.transferring || form.minting}
                onClick={() => void form.handleMoveUsdcToSmartWallet()}
              >
                {form.transferring ? (
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
            onClick={() => void form.handleMint()}
            disabled={!form.canMint}
            className={cn('w-full', form.minting && 'opacity-80')}
          >
            {form.minting ? (
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
