import { base, arbitrum } from 'viem/chains'

export const DEFAULT_CHAIN = base
export const SWITCHABLE_CHAINS = [base, arbitrum] as const

/** USDC contract address by chain ID. Only includes chains in SWITCHABLE_CHAINS. */
export const USDC_ADDRESS_BY_CHAIN_ID: Record<number, `0x${string}`> = {
  [base.id]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  [arbitrum.id]: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
}

/** Map chainId to configured chain. */
export const CHAIN_BY_ID: Record<number, (typeof SWITCHABLE_CHAINS)[number]> = {
  [base.id]: base,
  [arbitrum.id]: arbitrum,
}

export function getChainById(chainId: number): (typeof SWITCHABLE_CHAINS)[number] | undefined {
  return CHAIN_BY_ID[chainId]
}

export function requireChainById(chainId: number): (typeof SWITCHABLE_CHAINS)[number] {
  const chain = getChainById(chainId)
  if (!chain) throw new Error(`Unsupported chain id: ${chainId}`)
  return chain
}
