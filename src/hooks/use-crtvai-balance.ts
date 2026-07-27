import { useQuery } from '@tanstack/react-query'
import { formatUnits } from 'viem'
import { CRTVAI_DECIMALS, readCrtvaiBalance } from '@/config/metoken'

export interface UseCrtvaiBalanceResult {
  /** Raw balance in meToken wei (18 decimals). */
  balance: bigint | null
  /** Formatted display string (e.g. "1,234.56"). */
  formatted: string
  /** Human-friendly symbol for UI. */
  symbol: string
  isLoading: boolean
  isError: boolean
}

const CRTVAI_SYMBOL = 'CRTVAI'

/** Format meToken wei to a display string with up to 2 decimal places. */
function formatMetokenBalance(wei: bigint): string {
  const formatted = formatUnits(wei, CRTVAI_DECIMALS)
  const n = Number(formatted)
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

/**
 * Returns CRTVAI meToken balance for the given address on Base.
 * The meToken diamond is an ERC-2535 contract with a standard balanceOf facet.
 */
export function useCrtvaiBalance(address: `0x${string}` | undefined): UseCrtvaiBalanceResult {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['crtvai-balance', address],
    queryFn: () => readCrtvaiBalance(address!),
    enabled: Boolean(address),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const balance = data ?? null
  const formatted = balance !== null ? formatMetokenBalance(balance) : '—'

  return {
    balance,
    formatted,
    symbol: CRTVAI_SYMBOL,
    isLoading,
    isError,
  }
}
