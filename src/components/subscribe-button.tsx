'use client';

import { useAccount } from '@account-kit/react';
import { Sparkles, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePremiumMembership } from '@/features/live-ai/hooks/use-premium-membership';
import { useUnlockCheckout } from '@/hooks/use-unlock-checkout';

interface SubscribeButtonProps {
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

/**
 * Subscribe CTA for Pixels Premium ($30/mo, Unlock on Arbitrum).
 * - Not connected or checking membership: renders nothing.
 * - Not premium: "Subscribe $30/mo" opens Unlock Labs hosted checkout (USDC or Stripe card).
 * - Paid subscriber: "Manage subscription" opens Unlock keychain dashboard.
 * - DAO member (premium via Base DAO lock): renders nothing — they already have the rate.
 */
export function SubscribeButton({
  variant = 'default',
  size = 'sm',
  className,
}: SubscribeButtonProps) {
  const { address } = useAccount({ type: 'LightAccount' });
  const { isPremiumMember, isPaidSubscriber, isLoading } = usePremiumMembership(
    address as `0x${string}` | undefined
  );
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
      <span>Subscribe $30/mo</span>
    </Button>
  );
}
