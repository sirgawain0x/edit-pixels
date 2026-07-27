import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { formatUnits } from 'viem'
import { useWalletContext } from '@/context/wallet-context'
import { useCrtvaiBalance } from '@/hooks/use-crtvai-balance'
import { CRTVAI_DECIMALS } from '@/config/metoken'

/**
 * Bridge hook: exposes CRTVAI balance through the legacy credits interface.
 *
 * The server-side credits system has been deprecated in favor of CRTVAI meToken
 * on Base. 1 CRTVAI ≈ 1 legacy credit for display/gating purposes.
 */

export interface UseCreditsResult {
  balance: number
  configured: boolean
  isLoading: boolean
  isDegraded: boolean
  hasCredits: boolean
  refreshBalance: () => void
}

export function useCredits(): UseCreditsResult {
  const { account } = useWalletContext()
  const {
    balance: crtvaiBalance,
    isLoading,
    isError,
  } = useCrtvaiBalance(account as `0x${string}` | undefined)

  const queryClient = useQueryClient()

  const refreshBalance = useCallback(() => {
    if (account) {
      void queryClient.invalidateQueries({ queryKey: ['crtvai-balance', account] })
    }
  }, [account, queryClient])

  const balance = crtvaiBalance ? Number(formatUnits(crtvaiBalance, CRTVAI_DECIMALS)) : 0

  return {
    balance,
    configured: Boolean(account),
    isLoading,
    isDegraded: isError,
    hasCredits: balance > 0,
    refreshBalance,
  }
}
