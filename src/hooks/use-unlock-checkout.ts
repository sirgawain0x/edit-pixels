import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getPixelsPremiumLockAddress } from '@/infrastructure/unlock/membership';

const ARBITRUM_ONE_CHAIN_ID = 42_161;
const UNLOCK_CHECKOUT_BASE = 'https://app.unlock-protocol.com/checkout';
const UNLOCK_KEYCHAIN_URL = 'https://app.unlock-protocol.com/keychain';

export interface UseUnlockCheckoutResult {
  /** Opens Unlock Labs hosted checkout in a new tab. Supports USDC and Stripe card. */
  openSubscribeCheckout: () => void;
  /** Opens Unlock's keychain dashboard where users manage / cancel existing keys. */
  openManageSubscription: () => void;
  /** True when the lock address is configured. */
  isConfigured: boolean;
}

/**
 * Builds an Unlock Labs hosted checkout URL for the Pixels Premium lock on Arbitrum
 * and opens it in a new tab. On window refocus, invalidates the premium-membership
 * query so the UI picks up the new key without a full reload.
 */
export function useUnlockCheckout(): UseUnlockCheckoutResult {
  const queryClient = useQueryClient();
  const lockAddress = getPixelsPremiumLockAddress();

  const openSubscribeCheckout = useCallback(() => {
    if (!lockAddress) return;

    const paywallConfig = {
      locks: {
        [lockAddress]: {
          network: ARBITRUM_ONE_CHAIN_ID,
          recurringPayments: 'forever' as const,
        },
      },
      title: 'Pixels Premium',
      pessimistic: true,
      skipRecipient: false,
      redirectUri: window.location.href,
    };

    const encoded = encodeURIComponent(JSON.stringify(paywallConfig));
    const url = `${UNLOCK_CHECKOUT_BASE}?paywallConfig=${encoded}`;

    const refetchOnReturn = () => {
      void queryClient.invalidateQueries({ queryKey: ['premium-membership'] });
    };
    window.addEventListener('focus', refetchOnReturn);
    window.setTimeout(
      () => window.removeEventListener('focus', refetchOnReturn),
      5 * 60_000
    );

    window.open(url, '_blank', 'noopener,noreferrer');
  }, [lockAddress, queryClient]);

  const openManageSubscription = useCallback(() => {
    window.open(UNLOCK_KEYCHAIN_URL, '_blank', 'noopener,noreferrer');
  }, []);

  return {
    openSubscribeCheckout,
    openManageSubscription,
    isConfigured: Boolean(lockAddress),
  };
}
