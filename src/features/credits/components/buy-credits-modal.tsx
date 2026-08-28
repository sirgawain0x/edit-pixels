import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CreditPackCheckout } from './credit-pack-checkout'

interface BuyCreditsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Credits buy modal — fixed-price credit packs.
 *
 * The legacy server-side credits system has been deprecated in favor of CRTVAI
 * meToken. Buying "credits" now settles a fixed-price pack via the
 * CreditPackSettlement contract (atomic buy + burn + credit mint).
 */
export function BuyCreditsModal({ open, onOpenChange }: BuyCreditsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Buy credits</DialogTitle>
          <DialogDescription>
            Fixed-price credit packs. Pay in USDC — no curve slippage at checkout.
          </DialogDescription>
        </DialogHeader>
        <div className="pt-2">
          <CreditPackCheckout />
        </div>
      </DialogContent>
    </Dialog>
  )
}
