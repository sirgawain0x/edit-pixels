import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SendTokenFundingHintsProps {
  token: 'usdc' | 'crtvai'
  amountInput: string
  gasBufferUsdc6: number
  insufficientBalance: boolean
  canSendFromSigner: boolean
  needsMoveToSmartWallet: boolean
  transferring: boolean
  sending: boolean
  onMoveUsdcToSmartWallet: () => void
}

export function SendTokenFundingHints({
  token,
  amountInput,
  gasBufferUsdc6,
  insufficientBalance,
  canSendFromSigner,
  needsMoveToSmartWallet,
  transferring,
  sending,
  onMoveUsdcToSmartWallet,
}: SendTokenFundingHintsProps) {
  return (
    <>
      {token === 'usdc' && gasBufferUsdc6 > 0 && (
        <p className="text-xs text-muted-foreground">
          A small USDC reserve is kept for transaction gas.
        </p>
      )}
      {insufficientBalance && amountInput && !canSendFromSigner && (
        <p className="text-xs text-destructive">Insufficient smart wallet balance.</p>
      )}
      {canSendFromSigner && (
        <p className="text-xs text-amber-200/90">
          USDC is in your signer wallet — send will use that balance directly.
        </p>
      )}
      {needsMoveToSmartWallet && (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <p>USDC is in your signer wallet. Move it to your smart wallet to send CRTVAI later.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={transferring || sending}
            onClick={onMoveUsdcToSmartWallet}
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
    </>
  )
}
