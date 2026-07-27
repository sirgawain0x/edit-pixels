import { base, arbitrum } from 'viem/chains'

export const DEFAULT_CHAIN = base
export const SWITCHABLE_CHAINS = [base, arbitrum] as const

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
