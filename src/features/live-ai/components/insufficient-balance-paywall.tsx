'use client';

import { DollarSign, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWalletContext } from '@/context/wallet-context';
import { useBuyUsdcOnramp } from '@/hooks/use-buy-usdc-onramp';
import { useUnlockCheckout } from '@/hooks/use-unlock-checkout';
import {
  formatSubscribeCta,
  formatUsdRate,
  LIVE_AI_PREMIUM_HOURLY_USD,
} from '@/shared/utils/currency-display';
import { usePremiumMembership } from '../hooks/use-premium-membership';
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance';

/**
 * Paywall shown when the 5-minute billing charge fails due to insufficient CRTVAI
 * balance. Offers two paths out:
 *  - Buy more CRTVAI (mint via USDC on Base)
 *  - Subscribe $30/mo (unlocks premium $1.50/hr — 50% off the retail $3/hr rate)
 * Subscribers (and DAO members) only see "Buy CRTVAI" since their rate is already premium.
 */
export function InsufficientBalancePaywall() {
  const { account: address } = useWalletContext();
  const { isPremiumMember } = usePremiumMembership(address);
  const { openBuyUsdc, isLoading: isOnrampLoading } = useBuyUsdcOnramp();
  const { openSubscribeCheckout, isConfigured: isUnlockConfigured } =
    useUnlockCheckout();
  const { formatted: crtvaiFormatted, symbol } = useCrtvaiBalance(address);

  const showSubscribe = isUnlockConfigured && !isPremiumMember;

  return (
    <div className="mb-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs space-y-2">
      <p className="font-medium">
        Insufficient {symbol} balance ({crtvaiFormatted}). Buy more to continue.
      </p>
      {showSubscribe && (
        <p className="text-muted-foreground">
          Or subscribe to lock in the {formatUsdRate(LIVE_AI_PREMIUM_HOURLY_USD, 'hr')}{' '}
          rate — 50% off retail.
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
          {isOnrampLoading ? 'Opening…' : 'Buy USDC → Mint CRTVAI'}
        </Button>
        {showSubscribe && (
          <Button
            size="sm"
            className="text-xs"
            onClick={openSubscribeCheckout}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {formatSubscribeCta()}
          </Button>
        )}
      </div>
    </div>
  );
}