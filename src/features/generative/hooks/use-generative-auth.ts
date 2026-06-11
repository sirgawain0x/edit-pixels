import { useAccount, useSignMessage, useSmartAccountClient } from '@account-kit/react';
import { useMemo } from 'react';
import type { SignedRequestParams } from '../services/generative-proxy-client';

export function useGenerativeAuth(): SignedRequestParams | null {
  const { address } = useAccount({ type: 'LightAccount' });
  const { client } = useSmartAccountClient({ type: 'LightAccount' });
  const { signMessageAsync } = useSignMessage({ client });

  return useMemo(() => {
    if (!address || !client) return null;
    return {
      address: address as `0x${string}`,
      signMessage: (message: string) => signMessageAsync({ message }),
    };
  }, [address, client, signMessageAsync]);
}

export function useGenerativeReady(): boolean {
  const auth = useGenerativeAuth();
  return auth !== null;
}
