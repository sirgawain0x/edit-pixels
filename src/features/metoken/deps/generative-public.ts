/**
 * CRTVAI balance adapter for the generative feature.
 * Replaces the credits-based dependency with a simple CRTVAI balance check.
 * Users need CRTVAI tokens to pay for AI renders.
 */
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance';
import { useWalletContext } from '@/context/wallet-context';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

export interface UseCrtvaiCreditsResult {
  /** True when the user has any CRTVAI balance. */
  hasCredits: boolean;
  /** Refresh the CRTVAI balance (invalidates the query). */
  refreshBalance: () => void;
  /** Formatted CRTVAI balance string. */
  formatted: string;
  /** Token symbol. */
  symbol: string;
}

/**
 * Drop-in replacement for useCredits that checks CRTVAI meToken balance.
 * The generative feature uses this to gate renders on having a positive balance.
 */
export function useCrtvaiCredits(): UseCrtvaiCreditsResult {
  const { account } = useWalletContext();
  const { balance, formatted, symbol } = useCrtvaiBalance(account);
  const queryClient = useQueryClient();

  const refreshBalance = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['crtvai-balance', account] });
  }, [queryClient, account]);

  return {
    hasCredits: balance !== null && balance > 0n,
    refreshBalance,
    formatted,
    symbol,
  };
}