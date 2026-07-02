import { useMemo } from 'react';
import { useWalletContext } from '@/context/wallet-context';
import type { SignedRequestParams } from '../services/generative-proxy-client';

export function useGenerativeAuth(): SignedRequestParams | null {
  const { account, authenticated, getAccessToken } = useWalletContext();

  return useMemo(() => {
    if (!account || !authenticated) return null;
    return {
      getAccessToken,
      walletAddress: account,
    };
  }, [account, authenticated, getAccessToken]);
}

export function useGenerativeReady(): boolean {
  const auth = useGenerativeAuth();
  return auth !== null;
}
