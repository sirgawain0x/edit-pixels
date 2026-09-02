import type { QueryClient } from '@tanstack/react-query'

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function invalidateWalletTokenBalances(
  queryClient: QueryClient,
  chainId: number | undefined,
  account: `0x${string}` | undefined,
): void {
  if (!account) return
  void queryClient.invalidateQueries({ queryKey: ['usdc-balance', chainId, account] })
  void queryClient.invalidateQueries({ queryKey: ['crtvai-balance', account] })
}

export function invalidateUsdcBalance(
  queryClient: QueryClient,
  chainId: number | undefined,
  address: `0x${string}` | undefined,
): void {
  if (!address) return
  void queryClient.invalidateQueries({ queryKey: ['usdc-balance', chainId, address] })
}
