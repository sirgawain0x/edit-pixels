'use client';

import { Sparkles, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWalletContext } from '@/context/wallet-context';
import { usePremiumMembership } from '@/features/live-ai/hooks/use-premium-membership';
import { useUnlockCheckout } from '@/hooks/use-unlock-checkout';
import { formatSubscribeCta } from '@/shared/utils/currency-display';

interface SubscribeButtonProps {
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

/**
 * Pixels Premium subscribe / manage button.
 *
 * - No wallet or loading: renders nothing.
 * - Premium member via Base DAO lock: renders nothing (they already get the rate).
 * - Paid subscriber: "Manage subscription" opens Unlock keychain dashboard.
 * - Otherwise: opens the Unlock checkout (USDC or Stripe card).
 */
export function SubscribeButton({
  variant = 'default',
  size = 'sm',
  className,
}: SubscribeButtonProps) {
  const { wallet } = useWalletContext();
  const address = wallet?.address as `0x${string}` | undefined;
  const { isPremiumMember, isPaidSubscriber, isLoading } = usePremiumMembership(address);
  const { openSubscribeCheckout, openManageSubscription, isConfigured } =
    useUnlockCheckout();

  if (!address || isLoading || !isConfigured) return null;

  if (isPaidSubscriber) {
    return (
      <Button
        variant="ghost"
        size={size}
        className={className}
        onClick={openManageSubscription}
      >
        <Settings2 className="h-4 w-4 shrink-0" />
        <span>Manage subscription</span>
      </Button>
    );
  }

  if (isPremiumMember) return null;

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={openSubscribeCheckout}
    >
      <Sparkles className="h-4 w-4 shrink-0" />
      <span>{formatSubscribeCta()}</span>
    </Button>
  );
}
