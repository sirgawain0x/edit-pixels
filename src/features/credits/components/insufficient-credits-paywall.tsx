import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCredits } from '@/features/credits/hooks/use-credits'

interface InsufficientCreditsPaywallProps {
  /** Estimated credits required to perform the action. */
  requiredCredits?: number
  /** Called when the user chooses to buy more credits. */
  onBuyCredits: () => void
  /** Called when the user cancels/dismisses the paywall. */
  onCancel?: () => void
  open: boolean
}

/**
 * Paywall shown when the user's CRTVAI/credits balance is too low.
 *
 * This replaces the legacy server-side credits paywall. The action is gated by
 * the CRTVAI meToken balance shown through useCredits.
 */
export function InsufficientCreditsPaywall({
  requiredCredits = 1,
  onBuyCredits,
  onCancel,
  open,
}: InsufficientCreditsPaywallProps) {
  const { balance, isLoading } = useCredits()

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel?.()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Insufficient balance</DialogTitle>
          <DialogDescription>
            You need at least {requiredCredits} CRTVAI credits to continue.
            {isLoading ? null : ` Your balance is ${balance.toFixed(2)}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-4">
          <Button onClick={onBuyCredits}>Buy CRTVAI credits</Button>
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
