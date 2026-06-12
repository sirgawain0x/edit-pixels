'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccount, useChain } from '@account-kit/react';
import { Coins, DollarSign, Loader2, RefreshCw } from 'lucide-react';
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
  formatUsdcCheckout,
  formatUsdcRequiredApprox,
} from '@/shared/utils/currency-display';
import {
  canAffordAnyCreditPack,
  getUsdcRequiredForPack,
  hasEnoughUsdcForPack,
  packUsdcAmount,
} from '@/features/credits/usdc-for-purchase';
import { useBuyUsdcOnramp } from '@/hooks/use-buy-usdc-onramp';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';

const ARBITRUM_ONE_CHAIN_ID = 42_161;

interface PendingSync {
  txHash: `0x${string}`;
  credits: number;
}

interface BuyCreditsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BuyCreditsModal({ open, onOpenChange }: BuyCreditsModalProps) {
  const { t } = useTranslation();
  const { address } = useAccount({ type: 'sca' });
  const { chain } = useChain();
  const { purchasePack, syncPurchase } = useCredits();
  const { balance: usdcBalance, formatted: usdcFormatted } = useUsdcBalance(
    chain,
    address as `0x${string}` | undefined
  );
  const { openBuyUsdc, isLoading: isOnrampLoading } = useBuyUsdcOnramp();
  const [purchasingId, setPurchasingId] = useState<number | null>(null);
  const [pendingSync, setPendingSync] = useState<PendingSync | null>(null);
  const [retryingSync, setRetryingSync] = useState(false);

  useEffect(() => {
    if (!open) {
      setRetryingSync(false);
    }
  }, [open]);

  const onArbitrum = chain?.id === ARBITRUM_ONE_CHAIN_ID;
  const anyPackUnaffordable =
    usdcBalance !== null && !canAffordAnyCreditPack(usdcBalance);

  const handleRetrySync = async () => {
    if (!pendingSync) return;
    setRetryingSync(true);
    try {
      const result = await syncPurchase(pendingSync.txHash);
      if (result.ok) {
        toast.success(`Added ${pendingSync.credits} credits`);
        setPendingSync(null);
        onOpenChange(false);
      } else {
        toast.error(result.error ?? 'Sync failed', {
          description: result.syncPending
            ? 'Your USDC payment was received. Try syncing again.'
            : 'A terminal error occurred. Please contact support.',
        });
        if (!result.syncPending) {
          setPendingSync(null);
        }
      }
    } finally {
      setRetryingSync(false);
    }
  };

  const handleBuy = async (packId: number) => {
    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    if (!pack) return;

    if (!onArbitrum) {
      toast.error('Switch to Arbitrum to buy credits');
      return;
    }

    if (!hasEnoughUsdcForPack(usdcBalance, pack)) {
      const required = getUsdcRequiredForPack(pack);
      toast.error('Insufficient USDC', {
        description: `Need ${formatUsdcRequiredApprox(required)} on Arbitrum (includes gas). Use Buy USDC first.`,
      });
      return;
    }

    setPurchasingId(packId);
    setPendingSync(null);
    try {
      const result = await purchasePack(pack);
      if (result.ok) {
        toast.success(`Added ${pack.credits} credits`);
        onOpenChange(false);
      } else if (result.syncPending && result.txHash) {
        setPendingSync({ txHash: result.txHash, credits: pack.credits });
        toast.warning('Payment received — syncing credits', {
          description: 'Use Retry sync if credits do not appear shortly.',
        });
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
            {t('credits.buyTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('credits.buyDescription')}
            {usdcBalance !== null && (
              <span className="mt-1 block tabular-nums">
                Wallet USDC: {usdcFormatted}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        {pendingSync && (
          <div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
            <p className="font-medium text-amber-800 dark:text-amber-200">
              Payment received — credits syncing
            </p>
            <p className="text-muted-foreground">
              Your purchase of {pendingSync.credits} credits is being applied.
              This is safe to retry — you will not be charged twice.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit text-xs"
              disabled={retryingSync}
              onClick={() => void handleRetrySync()}
            >
              {retryingSync ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              {retryingSync ? 'Syncing…' : 'Retry sync'}
            </Button>
          </div>
        )}
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
            const affordable = hasEnoughUsdcForPack(usdcBalance, pack);
            return (
              <Button
                key={pack.id}
                variant="outline"
                className="relative h-auto flex-col items-start gap-0.5 py-3 text-left"
                disabled={
                  purchasingId !== null ||
                  pendingSync !== null ||
                  retryingSync ||
                  !onArbitrum ||
                  !affordable
                }
                onClick={() => void handleBuy(pack.id)}
              >
                <span className="flex w-full items-center justify-between font-medium">
                  {pack.name}
                  <span>{formatUsdcCheckout(packUsdcAmount(pack))}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {pack.credits} credits · {pack.description}
                </span>
                {usdcBalance !== null && !affordable && onArbitrum && (
                  <span className="text-xs text-amber-600">
                    Need {formatUsdcRequiredApprox(getUsdcRequiredForPack(pack))}{' '}
                    total
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
  return `${credits} Flow credits`;
}
