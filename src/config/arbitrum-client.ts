import { arbitrum } from 'viem/chains'
import { createPublicClient, http } from 'viem'
import { ALCHEMY_API_KEY } from '@/config/alchemy'

function getArbitrumRpcUrl(): string {
  if (!ALCHEMY_API_KEY) {
    // Fallback to a public Arbitrum RPC for read-only calls when Alchemy is not configured.
    return 'https://arb1.arbitrum.io/rpc'
  }
  return `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
}

/**
 * Read-only viem public client for Arbitrum One (mainnet).
 */
export function getArbitrumPublicClient() {
  return createPublicClient({
    chain: arbitrum,
    transport: http(getArbitrumRpcUrl()),
  })
}

export { arbitrum as arbitrumChain }
