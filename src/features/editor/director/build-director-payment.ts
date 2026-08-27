/**
 * Build a CRTVAI transfer UserOp paying the Director invoice to the treasury.
 */

import { encodeFunctionData, type Address, type Hex } from 'viem'
import {
  CRTVAI_DIAMOND_ADDRESS,
  METOKEN_ERC20_ABI,
  getSuperfluidReceiverAddress,
} from '@/config/metoken'
import type { SmartWalletOp } from '@/hooks/use-smart-wallet-ops'

export function getDirectorTreasuryAddress(): Address | undefined {
  return getSuperfluidReceiverAddress()
}

export function buildDirectorPaymentOp(amountWei: bigint): SmartWalletOp {
  const treasury = getDirectorTreasuryAddress()
  if (!treasury) {
    throw new Error('Director treasury not configured (VITE_SUPERFLUID_RECEIVER)')
  }
  if (amountWei <= 0n) {
    throw new Error('Director payment amount must be positive')
  }

  const data = encodeFunctionData({
    abi: METOKEN_ERC20_ABI,
    functionName: 'transfer',
    args: [treasury, amountWei],
  }) as Hex

  return {
    target: CRTVAI_DIAMOND_ADDRESS,
    data,
    value: 0n,
  }
}
