'use client';

import { useEffect, useRef } from 'react';
import { useAccount } from '@account-kit/react';
import { useQuery } from '@tanstack/react-query';
import { arbitrum } from '@account-kit/infra';
import { toast } from 'sonner';
import {
  checkPixelsPremium,
  getPixelsPremiumExpiry,
} from '@/infrastructure/unlock/membership';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';
import { useUnlockCheckout } from '@/hooks/use-unlock-checkout';

const DAY_SECONDS = 86_400;
const RENEWAL_WINDOW_DAYS = 3;
const LOW_BALANCE_THRESHOLD_USDC = 30;

interface SubStatus {
  hasValidKey: boolean;
  expiresAt: number | null;
}

async function fetchSubStatus(
  address: `0x${string}`
): Promise<SubStatus> {
  const [hasValidKey, expiresAt] = await Promise.all([
    checkPixelsPremium(address),
    getPixelsPremiumExpiry(address),
  ]);
  return { hasValidKey, expiresAt };
}

/**
 * Silent watcher: on mount and on address change, checks whether the user's
 * Pixels Premium subscription is at risk of failing to auto-renew. Fires at
 * most one toast per app session, keyed by alert type, so users aren't nagged.
 *
 *  - Key expired: user had a subscription, now doesn't → "Subscription expired"
 *  - Renewal risk: key valid, expiring within 3 days, USDC balance < $30 →
 *    "Renewal may fail — top up"
 */
export function SubscriptionRenewalWatcher() {
  const { address } = useAccount({ type: 'LightAccount' });
  const { openSubscribeCheckout, isConfigured } = useUnlockCheckout();
  const { balance: usdcBalance } = useUsdcBalance(
    arbitrum,
    address as `0x${string}` | undefined
  );

  const { data: subStatus } = useQuery({
    queryKey: ['sub-renewal-status', address],
    queryFn: () => fetchSubStatus(address!),
    enabled: Boolean(address && isConfigured),
    staleTime: 5 * 60_000,
  });

  const shownExpiredRef = useRef(false);
  const shownRenewalRiskRef = useRef(false);

  useEffect(() => {
    if (!subStatus || !address || !isConfigured) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = subStatus.expiresAt;

    const keyHadExpired =
      !subStatus.hasValidKey &&
      expiresAt !== null &&
      expiresAt > 0 &&
      expiresAt < nowSec;

    if (keyHadExpired && !shownExpiredRef.current) {
      shownExpiredRef.current = true;
      toast.error('Pixels Premium expired', {
        description:
          'Renew to restore the $1.50/hr rate and credit discounts.',
        action: { label: 'Renew', onClick: openSubscribeCheckout },
        duration: 12_000,
      });
      return;
    }

    const secondsUntilExpiry =
      expiresAt !== null ? expiresAt - nowSec : Infinity;
    const daysUntilExpiry = secondsUntilExpiry / DAY_SECONDS;
    const balanceNum = usdcBalance === null ? null : Number(usdcBalance);

    const atRenewalRisk =
      subStatus.hasValidKey &&
      daysUntilExpiry > 0 &&
      daysUntilExpiry <= RENEWAL_WINDOW_DAYS &&
      balanceNum !== null &&
      balanceNum < LOW_BALANCE_THRESHOLD_USDC;

    if (atRenewalRisk && !shownRenewalRiskRef.current) {
      shownRenewalRiskRef.current = true;
      const days = Math.max(1, Math.ceil(daysUntilExpiry));
      toast.warning('Pixels Premium renews soon', {
        description: `Renews in ~${days} day${days === 1 ? '' : 's'}. USDC balance is low — top up to avoid lapse.`,
        duration: 12_000,
      });
    }
  }, [subStatus, usdcBalance, address, isConfigured, openSubscribeCheckout]);

  return null;
}
