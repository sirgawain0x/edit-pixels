import { encodeFunctionData, erc20Abi } from 'viem'
import {
  CREDIT_PACK_SETTLEMENT_ADDRESS,
  CREDIT_PACK_SETTLEMENT_ABI,
  CREDIT_PACK_MAX_SLIPPAGE_BPS,
} from '@/config/credit-pack-settlement'
import { USDC_BASE_ADDRESS } from '@/config/metoken'
import type { SmartWalletOp } from '@/hooks/use-smart-wallet-ops'

/**
 * Builds the batched UserOperations for settling a fixed-price credit pack.
 *
 * Flow (mirrors the settlement contract):
 *  1. Approve USDC to the settlement contract (it pulls USDC via safeTransferFrom).
 *  2. Call `settlePack(buyer, packId, maxSlippageBps)` — atomic buy + burn + credit mint.
 *
 * `maxSlippageBps` is a fixed internal default (50 bps), never user-facing.
 */

export interface SettlePackOpsResult {
  ops: SmartWalletOp[]
}

/**
 * @param packId On-chain pack id (must be registered via `setPack`).
 * @param usdc6 Pack price in USDC6 (must match the on-chain `packPrice`).
 * @param buyer Buyer's smart-wallet address (also the credit recipient).
 */
export function buildSettlePackOps(
  packId: number,
  usdc6: bigint,
  buyer: `0x${string}`,
): SettlePackOpsResult {
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [CREDIT_PACK_SETTLEMENT_ADDRESS, usdc6],
  })

  const settleData = encodeFunctionData({
    abi: CREDIT_PACK_SETTLEMENT_ABI,
    functionName: 'settlePack',
    args: [buyer, BigInt(packId), CREDIT_PACK_MAX_SLIPPAGE_BPS],
  })

  return {
    ops: [
      { target: USDC_BASE_ADDRESS, data: approveData, value: 0n },
      { target: CREDIT_PACK_SETTLEMENT_ADDRESS, data: settleData, value: 0n },
    ],
  }
}
