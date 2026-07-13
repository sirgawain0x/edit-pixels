import { encodeFunctionData, erc20Abi } from 'viem';
import {
  CRTVAI_DIAMOND_ADDRESS,
  METOKEN_DIAMOND_ABI,
  USDC_BASE_ADDRESS,
} from '@/config/metoken';

/**
 * Builds the UserOperation calldata for buying (minting) CRTVAI meTokens.
 *
 * meToken mint flow:
 *  1. Approve USDC to the meToken diamond (it pulls USDC on mint)
 *  2. Call mint(amount) on the diamond — Bancor Zero formula computes output
 *
 * The smart wallet batched call executes both ops atomically.
 */

export interface BuyMetokenOpsResult {
  /** UserOperations to execute via smart wallet (approve + mint). */
  ops: Array<{ target: `0x${string}`; data: `0x${string}`; value: bigint }>;
}

/**
 * Build the batched user ops for minting CRTVAI with USDC.
 * @param usdcAmount Amount of USDC (raw, 6 decimals) to spend on minting.
 */
export function buildBuyMetokenOps(usdcAmount: bigint): BuyMetokenOpsResult {
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [CRTVAI_DIAMOND_ADDRESS, usdcAmount],
  });

  const mintData = encodeFunctionData({
    abi: METOKEN_DIAMOND_ABI,
    functionName: 'mint',
    args: [usdcAmount],
  });

  return {
    ops: [
      { target: USDC_BASE_ADDRESS, data: approveData, value: 0n },
      { target: CRTVAI_DIAMOND_ADDRESS, data: mintData, value: 0n },
    ],
  };
}

/**
 * Build the UserOperation calldata for selling (burning) CRTVAI back to USDC.
 * @param metokenAmount Amount of CRTVAI (raw, 18 decimals) to sell.
 */
export function buildSellMetokenOp(
  metokenAmount: bigint
): { target: `0x${string}`; data: `0x${string}`; value: bigint } {
  const sellData = encodeFunctionData({
    abi: METOKEN_DIAMOND_ABI,
    functionName: 'sell',
    args: [metokenAmount],
  });

  return {
    target: CRTVAI_DIAMOND_ADDRESS,
    data: sellData,
    value: 0n,
  };
}