import { getPurchaseGasBufferUsdc6 } from '@/config/gas-sponsorship'

/**
 * Calculate total USDC needed for a purchase, including any ERC-20 gas buffer.
 *
 * @param packUsdc6 Pack price in USDC6.
 * @param chainId Chain where the purchase happens.
 */
export function totalUsdcForPurchase(packUsdc6: number, chainId: number): number {
  return packUsdc6 + getPurchaseGasBufferUsdc6(chainId)
}

/**
 * Format a USDC6 amount as a dollar string (e.g. "$5.00").
 */
export function formatUsdc6(usdc6: number): string {
  return `$${(usdc6 / 1_000_000).toFixed(2)}`
}
