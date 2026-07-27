import { base } from 'viem/chains'
import { createPublicClient, http } from 'viem'
import { ALCHEMY_API_KEY } from '@/config/alchemy'

function getBaseRpcUrl(): string {
  if (!ALCHEMY_API_KEY) {
    throw new Error('VITE_ALCHEMY_API_KEY is required for Base client')
  }
  return `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
}

/**
 * Read-only viem public client for Base mainnet.
 */
export function getBasePublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(getBaseRpcUrl()),
  })
}

export { base as baseChain }
