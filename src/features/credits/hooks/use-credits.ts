import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWalletContext } from '@/context/wallet-context';

/**
 * @deprecated Credits system replaced by CRTVAI meToken.
 * This hook is kept as a stub for backward compatibility.
 * Use useCrtvaiBalance or useCrtvaiCredits from @/features/metoken instead.
 */

interface BalanceResponse {
  balance: number;
  configured: boolean;
  degraded?: boolean;
}

export interface UseCreditsResult {
  balance: number;
  configured: boolean;
  isLoading: boolean;
  isDegraded: boolean;
  hasCredits: boolean;
  refreshBalance: () => void;
}

export function useCredits(): UseCreditsResult {
  const { account } = useWalletContext();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['credits-balance', account],
    queryFn: async (): Promise<BalanceResponse> => ({ balance: 0, configured: false }),
    enabled: Boolean(account),
    staleTime: 60_000,
  });

  const refreshBalance = useCallback(() => {
    if (account) {
      void queryClient.invalidateQueries({ queryKey: ['credits-balance', account] });
    }
  }, [account, queryClient]);

  const balance = data?.balance ?? 0;
  return {
    balance,
    configured: false,
    isLoading,
    isDegraded: false,
    hasCredits: balance > 0,
    refreshBalance,
  };
}