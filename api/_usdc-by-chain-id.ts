/**
 * USDC contract addresses for server-side payment verification (must match `src/config/chains.ts`).
 */
import { arbitrum, base } from 'viem/chains'

export const USDC_ADDRESS_BY_CHAIN_ID: Record<number, `0x${string}`> = {
  [base.id]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  [arbitrum.id]: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
}
