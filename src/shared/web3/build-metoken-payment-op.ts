/**
 * Build a CRTVAI transfer UserOp.
 *
 * Shared rather than feature-local because more than one paid feature settles to the same
 * treasury with the same token: the Director invoices and Precision transcription runs both
 * pay in CRTVAI, and a second copy of this builder is a second place for the token address or
 * the ABI to drift.
 */
import { encodeFunctionData, type Address, type Hex } from 'viem'
import {
  CRTVAI_METOKEN_ADDRESS,
  METOKEN_ERC20_ABI,
  getSuperfluidReceiverAddress,
} from '@/config/metoken'
import type { SmartWalletOp } from '@/hooks/use-smart-wallet-ops'

export function buildCrtvaiTransferOp(amountWei: bigint, recipient?: Address): SmartWalletOp {
  const to = recipient ?? getSuperfluidReceiverAddress()
  if (!to) {
    throw new Error('CRTVAI treasury is not configured (VITE_SUPERFLUID_RECEIVER)')
  }
  if (amountWei <= 0n) {
    throw new Error('CRTVAI payment amount must be positive')
  }

  const data = encodeFunctionData({
    abi: METOKEN_ERC20_ABI,
    functionName: 'transfer',
    args: [to, amountWei],
  }) as Hex

  return {
    target: CRTVAI_METOKEN_ADDRESS,
    data,
    value: 0n,
  }
}
