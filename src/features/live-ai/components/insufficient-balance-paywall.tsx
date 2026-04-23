'use client';

import { useAccount } from '@account-kit/react';
import { DollarSign, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBuyUsdcOnramp } from '@/hooks/use-buy-usdc-onramp';
import { useUnlockCheckout } from '@/hooks/use-unlock-checkout';
import { usePremiumMembership } from '../hooks/use-premium-membership';

/**
 * Paywall shown when the 5-minute billing charge fails due to insufficient USDC
 * balance. Offers two paths out:
 *  - Top up USDC on Arbitrum (covers immediate retail-rate usage)
 *  - Subscribe $30/mo (unlocks premium $1.50/hr — 50% off the retail $3/hr rate)
 * Subscribers (and DAO members) only see "Top up" since their rate is already premium.
 */
export function InsufficientBalancePaywall() {
  const { address } = useAccount({ type: 'LightAccount' });
  const { isPremiumMember } = usePremiumMembership(
    address as `0x${string}` | undefined
  );
  const { openBuyUsdc, isLoading: isOnrampLoading } = useBuyUsdcOnramp();
  const { openSubscribeCheckout, isConfigured: isUnlockConfigured } =
    useUnlockCheckout();

  const showSubscribe = isUnlockConfigured && !isPremiumMember;

  return (
    <div className="mb-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs space-y-2">
      <p className="font-medium">Top up USDC on Arbitrum to continue.</p>
      {showSubscribe && (
        <p className="text-muted-foreground">
          Or subscribe to lock in the $1.50/hr rate — 50% off retail.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => void openBuyUsdc({ address: address ?? undefined })}
          disabled={isOnrampLoading}
        >
          <DollarSign className="h-3.5 w-3.5" aria-hidden />
          {isOnrampLoading ? 'Opening…' : 'Buy USDC'}
        </Button>
        {showSubscribe && (
          <Button
            size="sm"
            className="text-xs"
            onClick={openSubscribeCheckout}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Subscribe $30/mo
          </Button>
        )}
      </div>
    </div>
  );
}
