import { BuyMetokenModal } from '../deps/metoken'

interface BuyCreditsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Backward-compatible credits buy modal.
 *
 * The legacy server-side credits system has been deprecated in favor of CRTVAI
 * meToken. Buying "credits" now opens the CRTVAI mint flow.
 */
export function BuyCreditsModal({ open, onOpenChange }: BuyCreditsModalProps) {
  return <BuyMetokenModal open={open} onOpenChange={onOpenChange} />
}

export function CreditBalanceBadge() {
  return null
}
