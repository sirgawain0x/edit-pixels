'use client';

import { useState } from 'react';
import { useAccount, useChain } from '@account-kit/react';
import { Coins, DollarSign, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  CREDIT_PACKS,
  useCredits,
} from '@/features/credits/hooks/use-credits';
import {
  formatLiveAiTimeFromCredits,
  type CreditPackDefinition,
} from '@/config/credits';
import { getPurchaseGasBufferUsdc6 } from '@/config/gas-sponsorship';
import { useBuyUsdcOnramp } from '@/hooks/use-buy-usdc-onramp';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';

const ARBITRUM_ONE_CHAIN_ID = 42_161;

function packUsdcRequiredUsdc6(pack: CreditPackDefinition): number {
  return pack.usdc6 + getPurchaseGasBufferUsdc6(ARBITRUM_ONE_CHAIN_ID);
}

function hasEnoughUsdc(
  usdcBalance: string | null,
  pack: CreditPackDefinition
): boolean {
  if (usdcBalance === null) return false;
  return Number(usdcBalance) * 1_000_000 >= packUsdcRequiredUsdc6(pack);
}

function formatUsdcRequired(pack: CreditPackDefinition): string {
  return (packUsdcRequiredUsdc6(pack) / 1_000_000).toFixed(2);
}

interface BuyCreditsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BuyCreditsModal({ open, onOpenChange }: BuyCreditsModalProps) {
  const { address } = useAccount({ type: 'LightAccount' });
  const { chain } = useChain();
  const { purchasePack } = useCredits();
  const { balance: usdcBalance, formatted: usdcFormatted } = useUsdcBalance(
    chain,
    address as `0x${string}` | undefined
  );
  const { openBuyUsdc, isLoading: isOnrampLoading } = useBuyUsdcOnramp();
  const [purchasingId, setPurchasingId] = useState<number | null>(null);

  const onArbitrum = chain?.id === ARBITRUM_ONE_CHAIN_ID;
  const anyPackUnaffordable =
    usdcBalance !== null &&
    CREDIT_PACKS.some((pack) => !hasEnoughUsdc(usdcBalance, pack));

  const handleBuy = async (packId: number) => {
    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    if (!pack) return;

    if (!onArbitrum) {
      toast.error('Switch to Arbitrum to buy credits');
      return;
    }

    if (!hasEnoughUsdc(usdcBalance, pack)) {
      toast.error('Insufficient USDC', {
        description: `Need ~$${formatUsdcRequired(pack)} USDC on Arbitrum (includes gas). Use Buy USDC first.`,
      });
      return;
    }

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

  const handleBuyUsdc = () => {
    void openBuyUsdc({ address: address ?? undefined });
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
            {usdcBalance !== null && (
              <span className="mt-1 block tabular-nums">
                Wallet USDC: {usdcFormatted}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        {!onArbitrum && (
          <p className="text-xs text-amber-600">
            Connect on Arbitrum One to purchase credit packs.
          </p>
        )}
        {anyPackUnaffordable && onArbitrum && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              Top up USDC before buying — packs need pack price plus gas.
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0 text-xs"
              disabled={isOnrampLoading}
              onClick={handleBuyUsdc}
            >
              <DollarSign className="h-3.5 w-3.5" aria-hidden />
              {isOnrampLoading ? 'Opening…' : 'Buy USDC'}
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {CREDIT_PACKS.map((pack) => {
            const affordable = hasEnoughUsdc(usdcBalance, pack);
            return (
              <Button
                key={pack.id}
                variant="outline"
                className="relative h-auto flex-col items-start gap-0.5 py-3 text-left"
                disabled={
                  purchasingId !== null || !onArbitrum || !affordable
                }
                onClick={() => void handleBuy(pack.id)}
              >
                <span className="flex w-full items-center justify-between font-medium">
                  {pack.name}
                  <span>${(pack.usdc6 / 1_000_000).toFixed(0)} USDC</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {pack.credits} credits · {pack.description}
                </span>
                {usdcBalance !== null && !affordable && onArbitrum && (
                  <span className="text-xs text-amber-600">
                    Need ~${formatUsdcRequired(pack)} USDC total
                  </span>
                )}
                {purchasingId === pack.id && (
                  <Loader2
                    className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin"
                    aria-hidden
                  />
                )}
              </Button>
            );
          })}
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
  const { balance, isLoading, isDegraded } = useCredits();

  const label = isLoading ? '…' : isDegraded ? `${balance} cr?` : `${balance} cr`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        className ??
        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium tabular-nums hover:bg-muted/50'
      }
      aria-label={
        isDegraded
          ? 'Credit balance unavailable — service may be degraded'
          : 'Credit balance'
      }
      title={isDegraded ? 'Credits balance temporarily unavailable' : undefined}
    >
      <Coins className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
      {label}
    </button>
  );
}

export function formatCreditsSummary(credits: number): string {
  return `${credits} credits (${formatLiveAiTimeFromCredits(credits)} Live AI)`;
}
