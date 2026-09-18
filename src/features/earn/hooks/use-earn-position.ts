import { useQuery } from '@tanstack/react-query'
import { useWalletContext } from '@/context/wallet-context'
import { fetchEarnPosition } from '@/features/earn/api/earn-client'

export function useEarnPosition(enabled: boolean) {
  const { authenticated, getAccessToken } = useWalletContext()

  return useQuery({
    queryKey: ['earn-position'],
    queryFn: async () => {
      const token = await getAccessToken()
      if (!token) throw new Error('Not authenticated')
      return fetchEarnPosition(token)
    },
    enabled: enabled && authenticated,
    staleTime: 15_000,
    retry: 1,
  })
}
