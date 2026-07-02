import { arbitrum } from 'viem/chains';
import { createPublicClient, http } from 'viem';

const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;

function getArbitrumRpcUrl(): string {
  if (!apiKey) {
    throw new Error('VITE_ALCHEMY_API_KEY is required for Arbitrum client');
  }
  return `https://arb-mainnet.g.alchemy.com/v2/${apiKey}`;
}

/**
 * Read-only viem public client for Arbitrum One (mainnet).
 */
export function getArbitrumPublicClient() {
  return createPublicClient({
    chain: arbitrum,
    transport: http(getArbitrumRpcUrl()),
  });
}

export { arbitrum as arbitrumChain };
