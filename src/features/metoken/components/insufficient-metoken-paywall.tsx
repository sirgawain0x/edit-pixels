'use client';

import { useState } from 'react';
import { Coins, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useWalletContext } from '@/context/wallet-context';
import { BuyMetokenModal } from '@/features/metoken';
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';
import { HeadlessCdpOnramp } from '@/components/headless-cdp-onramp';

interface InsufficientMetokenPaywallProps {
  message?: string;
}

/**
 * Paywall shown when the user has no CRTVAI balance for generative AI renders.
 *
 * Enforces the USDC-first rule:
 *   - If the wallet has no USDC, the primary action is "Buy USDC".
 *   - If the wallet has USDC, the primary action is "Buy CRTVAI".
 */
export function InsufficientMetokenPaywall({
  message = 'Buy CRTVAI to generate AI renders.',
}: InsufficientMetokenPaywallProps) {
  const { account, chain } = useWalletContext();
  const { formatted, symbol } = useCrtvaiBalance(account);
  const { balance: usdcBalance } = useUsdcBalance(chain, account);
  const [buyOpen, setBuyOpen] = useState(false);
  const [onrampOpen, setOnrampOpen] = useState(false);

  const hasAnyUsdc = Boolean(usdcBalance && Number(usdcBalance) > 0);

  return (
    <>
      <div className="mb-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs space-y-2">
        <p className="font-medium">
          {symbol} balance: {formatted}
        </p>
        <p className="text-muted-foreground">{message}</p>
        {!hasAnyUsdc && (
          <p className="text-muted-foreground">
            You need USDC in your wallet before you can buy {symbol}.
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
              onClick={() => setBuyOpen(true)}
            >
              <Coins className="h-3.5 w-3.5" aria-hidden />
              Buy {symbol}
            </Button>
          )}
        </div>
      </div>
      <BuyMetokenModal open={buyOpen} onOpenChange={setBuyOpen} />

      <Dialog open={onrampOpen} onOpenChange={setOnrampOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" aria-hidden />
              Buy USDC
            </DialogTitle>
            <DialogDescription>
              Fund your wallet with USDC on Base, then come back to buy {symbol}
              for AI generation.
            </DialogDescription>
          </DialogHeader>
          <HeadlessCdpOnramp
            address={account}
            onSuccess={() => {
              setOnrampOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
