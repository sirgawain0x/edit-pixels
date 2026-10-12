// fallow-ignore-file unused-export
import { useMemo } from 'react'
import { useWalletContext } from '@/context/wallet-context'
import type { SignedRequestParams } from '../services/generative-proxy-client'

export function useGenerativeAuth(): SignedRequestParams | null {
  const { account, signerAddress, authenticated, getAccessToken } = useWalletContext()

  return useMemo(() => {
    if (!account || !signerAddress || !authenticated) return null
    return {
      getAccessToken,
      signerAddress,
      payerAddress: account,
    }
  }, [account, signerAddress, authenticated, getAccessToken])
}

export function useGenerativeReady(): boolean {
  const auth = useGenerativeAuth()
  return auth !== null
}
