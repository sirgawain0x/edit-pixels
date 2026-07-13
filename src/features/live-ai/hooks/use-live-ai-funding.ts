import { useQuery } from '@tanstack/react-query';
import { base } from 'viem/chains';
import { getPurchaseGasBufferUsdc6 } from '@/config/gas-sponsorship';
import {
  wrapMetokenWeiForOneHour,
  SUPERFLUID_CHAIN_ID,
} from '@/config/metoken';
import { usePremiumMembership } from '@/features/live-ai/hooks/use-premium-membership';
import { readCrtvaiBalanceBase } from '../api/superfluid-flow';

export interface UseLiveAiFundingResult {
  /** CRTVAI balance on Base (meToken wei, 18 decimals) as bigint. */
  crtvaiBalance: bigint;
  /** CRTVAI balance formatted for display. */
  crtvaiFormatted: string;
  /** Minimum CRTVAI (meToken wei) required to start streaming. */
  minRequiredMetokenWei: bigint;
  hasFunding: boolean;
  isLoading: boolean;
  hourlyUsdc: number;
  isPremiumMember: boolean;
}

/**
 * Checks CRTVAI balance on Base for starting Live AI (Superfluid streaming).
 */
export function useLiveAiFunding(
  address: `0x${string}` | undefined
): UseLiveAiFundingResult {
  const { intervalCostUsdc6, isPremiumMember, isLoading: tierLoading } =
    usePremiumMembership(address);

  const wrapMetokenWei = wrapMetokenWeiForOneHour(intervalCostUsdc6);
  const minRequiredMetokenWei =
    wrapMetokenWei +
    BigInt(getPurchaseGasBufferUsdc6(SUPERFLUID_CHAIN_ID)) * 10n ** 12n;
  const hourlyUsdc = (intervalCostUsdc6 * 12) / 1_000_000;

  const { data, isLoading: balanceLoading } = useQuery({
    queryKey: ['live-ai-crtvai-base', address],
    queryFn: async () => {
      const raw = await readCrtvaiBalanceBase(address!);
      return raw;
    },
    enabled: Boolean(address),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const crtvaiBalance = data ?? 0n;
  const hasFunding = crtvaiBalance >= minRequiredMetokenWei;

  const crtvaiFormatted = Number(crtvaiBalance) > 0
    ? (Number(crtvaiBalance) / 1e18).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })
    : '0';

  return {
    crtvaiBalance,
    crtvaiFormatted,
    minRequiredMetokenWei,
    hasFunding,
    isLoading: tierLoading || balanceLoading,
    hourlyUsdc,
    isPremiumMember,
  };
}

/** Chain required for Superfluid Live AI billing. */
export const LIVE_AI_BILLING_CHAIN = base;