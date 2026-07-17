'use client';

import { Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWalletContext } from '@/context/wallet-context';
import { BuyMetokenModal } from '@/features/metoken';
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance';
import { useState } from 'react';

interface InsufficientMetokenPaywallProps {
  message?: string;
}

/**
 * Paywall shown when the user has no CRTVAI balance for generative AI renders.
 * Offers a "Buy CRTVAI" button that opens the mint modal.
 */
export function InsufficientMetokenPaywall({
  message = 'Buy CRTVAI to generate AI renders.',
}: InsufficientMetokenPaywallProps) {
  const { account } = useWalletContext();
  const { formatted, symbol } = useCrtvaiBalance(account);
  const [buyOpen, setBuyOpen] = useState(false);

  return (
    <>
      <div className="mb-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs space-y-2">
        <p className="font-medium">
          {symbol} balance: {formatted}
        </p>
        <p className="text-muted-foreground">{message}</p>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => setBuyOpen(true)}
        >
          <Coins className="h-3.5 w-3.5" aria-hidden />
          Buy CRTVAI
        </Button>
      </div>
      <BuyMetokenModal open={buyOpen} onOpenChange={setBuyOpen} />
    </>
  );
}