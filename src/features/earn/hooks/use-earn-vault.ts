import { useQuery } from '@tanstack/react-query'
import { fetchEarnVault } from '@/features/earn/api/earn-client'

export function useEarnVault(enabled: boolean) {
  return useQuery({
    queryKey: ['earn-vault'],
    queryFn: fetchEarnVault,
    enabled,
    staleTime: 60_000,
    retry: 1,
  })
}
