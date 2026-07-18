'use client';

import { useState } from 'react';
import { Coins, DollarSign, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useWalletContext } from '@/context/wallet-context';
import { useUnlockCheckout } from '@/hooks/use-unlock-checkout';
import {
  formatSubscribeCta,
  formatUsdRate,
  LIVE_AI_PREMIUM_HOURLY_USD,
} from '@/shared/utils/currency-display';
import { usePremiumMembership } from '../hooks/use-premium-membership';
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';
import { BuyMetokenModal } from '../deps/metoken';
import { HeadlessCdpOnramp } from '@/components/headless-cdp-onramp';

/**
 * Paywall shown when Live AI cannot start due to insufficient funding.
 *
 * Enforces the USDC-first rule:
 *   1. If the wallet has no USDC, the only primary action is "Buy USDC".
 *   2. If the wallet has USDC but no CRTVAI, the primary action is "Buy CRTVAI".
 *   3. If the user is not a premium member, also offer Subscribe for the lower rate.
 */
export function InsufficientBalancePaywall() {
  const { account: address, chain } = useWalletContext();
  const { isPremiumMember } = usePremiumMembership(address);
  const { openSubscribeCheckout, isConfigured: isUnlockConfigured } =
    useUnlockCheckout();
  const { formatted: crtvaiFormatted, symbol } = useCrtvaiBalance(address);
  const { balance: usdcBalance } = useUsdcBalance(chain, address);

  const [buyMetokenOpen, setBuyMetokenOpen] = useState(false);
  const [onrampOpen, setOnrampOpen] = useState(false);

  const hasAnyUsdc = Boolean(usdcBalance && Number(usdcBalance) > 0);
  const showSubscribe = isUnlockConfigured && !isPremiumMember;

  return (
    <>
      <div className="mb-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs space-y-2">
        <p className="font-medium">
          Insufficient {symbol} balance ({crtvaiFormatted}). Add funds to
          continue.
        </p>
        {!hasAnyUsdc && (
          <p className="text-muted-foreground">
            You need USDC in your wallet before you can buy {symbol} for Live AI
            streaming.
          </p>
        )}
        {showSubscribe && (
          <p className="text-muted-foreground">
            Or subscribe to lock in the{' '}
            {formatUsdRate(LIVE_AI_PREMIUM_HOURLY_USD, 'hr')}{' '}
            rate — 50% off retail.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!hasAnyUsdc ? (
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setOnrampOpen(true)}
            >
              <DollarSign className="h-3.5 w-3.5" aria-hidden />
              Buy USDC first
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setBuyMetokenOpen(true)}
            >
              <Coins className="h-3.5 w-3.5" aria-hidden />
              Buy {symbol}
            </Button>
          )}
          {showSubscribe && (
            <Button size="sm" className="text-xs" onClick={openSubscribeCheckout}>
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {formatSubscribeCta()}
            </Button>
          )}
        </div>
      </div>

      <BuyMetokenModal open={buyMetokenOpen} onOpenChange={setBuyMetokenOpen} />

      <Dialog open={onrampOpen} onOpenChange={setOnrampOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" aria-hidden />
              Buy USDC
            </DialogTitle>
            <DialogDescription>
              Fund your wallet with USDC on Base, then come back to buy {symbol}
              for Live AI streaming.
            </DialogDescription>
          </DialogHeader>
          <HeadlessCdpOnramp
            address={address}
            onSuccess={() => {
              setOnrampOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
