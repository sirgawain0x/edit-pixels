'use client';

import { useState } from 'react';
import { Coins, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BuyCreditsModal } from '@/features/credits/components/buy-credits-modal';
import { RedeemPromoModal } from '@/features/credits/components/redeem-promo-modal';

interface InsufficientCreditsPaywallProps {
  /** Optional override message */
  message?: string;
}

/**
 * Shown when Flow generation requires credits and balance is zero.
 * Live AI uses USDC streaming (Superfluid), not credits.
 */
export function InsufficientCreditsPaywall({
  message = 'Buy credits or redeem a promo code for Flow image and video generation.',
}: InsufficientCreditsPaywallProps) {
  const [buyOpen, setBuyOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);

  return (
    <>
      <div className="mb-2 space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
        <p className="font-medium">Flow credits required</p>
        <p className="text-muted-foreground">{message}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="text-xs"
            onClick={() => setBuyOpen(true)}
          >
            <Coins className="h-3.5 w-3.5" aria-hidden />
            Buy credits
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setRedeemOpen(true)}
          >
            <Gift className="h-3.5 w-3.5" aria-hidden />
            Redeem code
          </Button>
        </div>
      </div>
      <BuyCreditsModal open={buyOpen} onOpenChange={setBuyOpen} />
      <RedeemPromoModal open={redeemOpen} onOpenChange={setRedeemOpen} />
    </>
  );
}

export function CreditsRequiredHint({ creditsNeeded }: { creditsNeeded: number }) {
  return (
    <p className="text-xs text-muted-foreground">
      Requires {creditsNeeded} Flow credits
    </p>
  );
}
