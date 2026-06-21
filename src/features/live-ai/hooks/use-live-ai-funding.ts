import { useQuery } from '@tanstack/react-query';
import { arbitrum } from 'viem/chains';
import { getPurchaseGasBufferUsdc6 } from '@/config/gas-sponsorship';
import { wrapUsdc6ForOneHour, SUPERFLUID_CHAIN_ID } from '@/config/superfluid';
import { usePremiumMembership } from '@/features/live-ai/hooks/use-premium-membership';
import { readUsdcBalanceArbitrum } from '../api/superfluid-flow';

export interface UseLiveAiFundingResult {
  /** USDC on Arbitrum (6 decimals) as number. */
  usdcBalance6: number;
  minRequiredUsdc6: number;
  hasFunding: boolean;
  isLoading: boolean;
  hourlyUsdc: number;
  isPremiumMember: boolean;
}

/**
 * Checks Arbitrum USDC balance for starting Live AI (Superfluid streaming).
 */
export function useLiveAiFunding(
  address: `0x${string}` | undefined
): UseLiveAiFundingResult {
  const { intervalCostUsdc6, isPremiumMember, isLoading: tierLoading } =
    usePremiumMembership(address);

  const wrapUsdc6 = Number(wrapUsdc6ForOneHour(intervalCostUsdc6));
  const minRequiredUsdc6 =
    wrapUsdc6 + getPurchaseGasBufferUsdc6(SUPERFLUID_CHAIN_ID);
  const hourlyUsdc = wrapUsdc6 / 1_000_000;

  const { data, isLoading: balanceLoading } = useQuery({
    queryKey: ['live-ai-usdc-arbitrum', address],
    queryFn: async () => {
      const raw = await readUsdcBalanceArbitrum(address!);
      return Number(raw);
    },
    enabled: Boolean(address),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const usdcBalance6 = data ?? 0;
  const hasFunding = usdcBalance6 >= minRequiredUsdc6;

  return {
    usdcBalance6,
    minRequiredUsdc6,
    hasFunding,
    isLoading: tierLoading || balanceLoading,
    hourlyUsdc,
    isPremiumMember,
  };
}

/** Chain required for Superfluid Live AI billing. */
export const LIVE_AI_BILLING_CHAIN = arbitrum;
