import { useQuery } from '@tanstack/react-query';
import {
  INTERVAL_COST_PREMIUM_USDC6,
  INTERVAL_COST_RETAIL_USDC6,
} from '@/config/billing';
import {
  checkPixelsPremium,
  checkPremiumMembership,
} from '@/infrastructure/unlock/membership';

export interface UsePremiumMembershipResult {
  isPremiumMember: boolean;
  isDaoMember: boolean;
  isPaidSubscriber: boolean;
  intervalCostUsdc6: number;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Resolves premium tier by checking both:
 *  - Creative Organization DAO membership on Base (Unlock Protocol), AND
 *  - Pixels Premium paid subscription on Arbitrum (Unlock Protocol).
 * Either path unlocks the premium rate ($0.125 / 5 min = $1.50/hr). Otherwise retail.
 */
export function usePremiumMembership(
  address: `0x${string}` | undefined
): UsePremiumMembershipResult {
  const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['premium-membership', address],
    queryFn: async () => {
      const [isDaoMember, isPaidSubscriber] = await Promise.all([
        checkPremiumMembership(address!),
        checkPixelsPremium(address!),
      ]);
      return { isDaoMember, isPaidSubscriber };
    },
    enabled: Boolean(address && apiKey),
    staleTime: 60_000,
  });

  const isDaoMember = data?.isDaoMember === true;
  const isPaidSubscriber = data?.isPaidSubscriber === true;
  const isPremiumMember = isDaoMember || isPaidSubscriber;

  const intervalCostUsdc6 = isPremiumMember
    ? INTERVAL_COST_PREMIUM_USDC6
    : INTERVAL_COST_RETAIL_USDC6;

  return {
    isPremiumMember,
    isDaoMember,
    isPaidSubscriber,
    intervalCostUsdc6,
    isLoading,
    isError,
  };
}
