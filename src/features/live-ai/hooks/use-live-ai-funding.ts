import { useQuery } from '@tanstack/react-query';
import { base } from 'viem/chains';
import { getPurchaseGasBufferUsdc6 } from '@/config/gas-sponsorship';
import {
  wrapMetokenWeiForOneHour,
  SUPERFLUID_CHAIN_ID,
} from '@/config/metoken';
import { usePremiumMembership } from '@/features/live-ai/hooks/use-premium-membership';
import { readCrtvaiBalanceBase } from '../api/superfluid-flow';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';
import { useWalletContext } from '@/context/wallet-context';

export interface UseLiveAiFundingResult {
  /** CRTVAI balance on Base (meToken wei, 18 decimals). */
  crtvaiBalance: bigint;
  /** CRTVAI balance formatted for display. */
  crtvaiFormatted: string;
  /** Minimum CRTVAI (meToken wei) required to start streaming. */
  minRequiredMetokenWei: bigint;
  /** Minimum USDC (6 decimals) required for gas buffer. */
  minRequiredUsdc6: number;
  /** True when user has enough CRTVAI for streaming AND USDC for gas. */
  hasFunding: boolean;
  isLoading: boolean;
  hourlyUsdc: number;
  isPremiumMember: boolean;
}

/**
 * Checks CRTVAI balance on Base for starting Live AI (Superfluid streaming).
 *
 * Gas is paid in USDC via an ERC-20 paymaster — so the funding check verifies
 * BOTH that the user has enough CRTVAI to wrap for one hour of streaming AND
 * enough USDC to cover the gas buffer.
 */
export function useLiveAiFunding(
  address: `0x${string}` | undefined
): UseLiveAiFundingResult {
  const { chain } = useWalletContext();
  const { intervalCostUsdc6, isPremiumMember, isLoading: tierLoading } =
    usePremiumMembership(address);

  const wrapMetokenWei = wrapMetokenWeiForOneHour(intervalCostUsdc6);
  const minRequiredMetokenWei = wrapMetokenWei;
  const minRequiredUsdc6 = getPurchaseGasBufferUsdc6(SUPERFLUID_CHAIN_ID);
  const hourlyUsdc = (intervalCostUsdc6 * 12) / 1_000_000;

  const { data: crtvaiData, isLoading: crtvaiLoading } = useQuery({
    queryKey: ['live-ai-crtvai-base', address],
    queryFn: async () => {
      const raw = await readCrtvaiBalanceBase(address!);
      return raw;
    },
    enabled: Boolean(address),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { balance: usdcBalanceStr } = useUsdcBalance(chain, address);
  const usdcBalance6 = usdcBalanceStr ? Number(usdcBalanceStr) * 1_000_000 : 0;

  const crtvaiBalance = crtvaiData ?? 0n;
  const hasCrtvai = crtvaiBalance >= minRequiredMetokenWei;
  const hasUsdcForGas = usdcBalance6 >= minRequiredUsdc6;
  const hasFunding = hasCrtvai && hasUsdcForGas;

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
    minRequiredUsdc6,
    hasFunding,
    isLoading: tierLoading || crtvaiLoading,
    hourlyUsdc,
    isPremiumMember,
  };
}

/** Chain required for Superfluid Live AI billing. */
export const LIVE_AI_BILLING_CHAIN = base;