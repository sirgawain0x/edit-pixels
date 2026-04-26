import { arbitrum } from '@account-kit/infra';
import { createPublicClient, http } from 'viem';

const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;

function getArbitrumRpcUrl(): string {
  const alchemyHttp = arbitrum.rpcUrls?.alchemy?.http?.[0];
  if (!alchemyHttp) {
    throw new Error('Arbitrum chain has no Alchemy RPC URL');
  }
  if (!apiKey) {
    throw new Error('VITE_ALCHEMY_API_KEY is required for Arbitrum client');
  }
  return `${alchemyHttp}/${apiKey}`;
}

/**
 * Read-only viem public client for Arbitrum One (mainnet).
 * Uses the same VITE_ALCHEMY_API_KEY as Account Kit for deterministic behavior.
 */
export function getArbitrumPublicClient() {
  const rpcUrl = getArbitrumRpcUrl();
  return createPublicClient({
    chain: arbitrum,
    transport: http(rpcUrl),
  });
}

export { arbitrum as arbitrumChain };
