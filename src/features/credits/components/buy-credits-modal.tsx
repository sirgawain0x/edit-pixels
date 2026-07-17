'use client';

/**
 * @deprecated Credits system replaced by CRTVAI meToken.
 * Use BuyMetokenModal from @/features/metoken instead.
 * This stub is kept for backward compatibility with the credits barrel export.
 */

interface BuyCreditsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

 
export function BuyCreditsModal(props: BuyCreditsModalProps) {
  void props;
  return null;
}

export function CreditBalanceBadge() {
  return null;
}