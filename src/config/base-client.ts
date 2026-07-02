import { base } from 'viem/chains';
import { createPublicClient, http } from 'viem';

const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;

function getBaseRpcUrl(): string {
  if (!apiKey) {
    throw new Error('VITE_ALCHEMY_API_KEY is required for Base client');
  }
  return `https://base-mainnet.g.alchemy.com/v2/${apiKey}`;
}

/**
 * Read-only viem public client for Base (mainnet).
 */
export function getBasePublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(getBaseRpcUrl()),
  });
}

export { base as baseChain };
