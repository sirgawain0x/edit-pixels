import { encodeFunctionData, erc20Abi } from 'viem'
import {
  CRTVAI_METOKEN_ADDRESS,
  CRTVAI_DIAMOND_ADDRESS,
  CRTVAI_HUB_2_VAULT_ADDRESS,
  METOKEN_DIAMOND_ABI,
  USDC_BASE_ADDRESS,
} from '@/config/metoken'

/**
 * Builds the UserOperation calldata for buying (minting) CRTVAI meTokens.
 *
 * meToken mint flow (FoundryFacet on the Diamond):
 *  1. Approve USDC to the hub-2 VAULT (the FoundryFacet pulls USDC from the
 *     caller via `vault.handleDeposit` → `safeTransferFrom`).
 *  2. Call `mint(meToken, assetsDeposited, recipient)` on the Diamond.
 *
 * The smart wallet batched call executes both ops atomically.
 */

export interface SmartWalletOp {
  target: `0x${string}`
  data: `0x${string}`
  value: bigint
}

export interface BuyMetokenOpsResult {
  /** UserOperations to execute via smart wallet (approve + mint). */
  ops: SmartWalletOp[]
}

/**
 * Build the batched user ops for minting CRTVAI with USDC.
 * @param usdcAmount Amount of USDC (raw, 6 decimals) to spend on minting.
 * @param recipient Address to receive the minted CRTVAI (defaults to the buyer).
 */
export function buildBuyMetokenOps(
  usdcAmount: bigint,
  recipient: `0x${string}`,
): BuyMetokenOpsResult {
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [CRTVAI_HUB_2_VAULT_ADDRESS, usdcAmount],
  })

  const mintData = encodeFunctionData({
    abi: METOKEN_DIAMOND_ABI,
    functionName: 'mint',
    args: [CRTVAI_METOKEN_ADDRESS, usdcAmount, recipient],
  })

  return {
    ops: [
      { target: USDC_BASE_ADDRESS, data: approveData, value: 0n },
      { target: CRTVAI_DIAMOND_ADDRESS, data: mintData, value: 0n },
    ],
  }
}

/**
 * Build the UserOperation calldata for selling (burning) CRTVAI back to USDC.
 * @param metokenAmount Amount of CRTVAI (raw, 18 decimals) to sell.
 * @param recipient Address to receive the returned USDC (defaults to the seller).
 */
export function buildSellMetokenOp(metokenAmount: bigint, recipient: `0x${string}`): SmartWalletOp {
  const sellData = encodeFunctionData({
    abi: METOKEN_DIAMOND_ABI,
    functionName: 'burn',
    args: [CRTVAI_METOKEN_ADDRESS, metokenAmount, recipient],
  })

  return {
    target: CRTVAI_DIAMOND_ADDRESS,
    data: sellData,
    value: 0n,
  }
}
