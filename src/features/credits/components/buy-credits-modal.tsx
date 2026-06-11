'use client';

import { useState } from 'react';
import { Coins, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CREDIT_PACKS, useCredits } from '@/features/credits/hooks/use-credits';
import { formatLiveAiTimeFromCredits } from '@/config/credits';

interface BuyCreditsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BuyCreditsModal({ open, onOpenChange }: BuyCreditsModalProps) {
  const { purchasePack } = useCredits();
  const [purchasingId, setPurchasingId] = useState<number | null>(null);

  const handleBuy = async (packId: number) => {
    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    setPurchasingId(packId);
    try {
      const result = await purchasePack(pack);
      if (result.ok) {
        toast.success(`Added ${pack.credits} credits`);
        onOpenChange(false);
      } else {
        toast.error(result.error ?? 'Purchase failed');
      }
    } finally {
      setPurchasingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" aria-hidden />
            Buy credits
          </DialogTitle>
          <DialogDescription>
            Pay with USDC on Arbitrum. Credits unlock Live AI and Flow generation.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {CREDIT_PACKS.map((pack) => (
            <Button
              key={pack.id}
              variant="outline"
              className="h-auto flex-col items-start gap-0.5 py-3 text-left"
              disabled={purchasingId !== null}
              onClick={() => void handleBuy(pack.id)}
            >
              <span className="flex w-full items-center justify-between font-medium">
                {pack.name}
                <span>${(pack.usdc6 / 1_000_000).toFixed(0)} USDC</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {pack.credits} credits · {pack.description}
              </span>
              {purchasingId === pack.id && (
                <Loader2 className="absolute right-3 h-4 w-4 animate-spin" aria-hidden />
              )}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface CreditBalanceBadgeProps {
  onClick?: () => void;
  className?: string;
}

export function CreditBalanceBadge({ onClick, className }: CreditBalanceBadgeProps) {
  const { balance, isLoading } = useCredits();

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        className ??
        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium tabular-nums hover:bg-muted/50'
      }
      aria-label="Credit balance"
    >
      <Coins className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
      {isLoading ? '…' : `${balance} cr`}
    </button>
  );
}

export function formatCreditsSummary(credits: number): string {
  return `${credits} credits (${formatLiveAiTimeFromCredits(credits)} Live AI)`;
}
