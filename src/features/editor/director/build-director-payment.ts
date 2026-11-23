/**
 * Build a CRTVAI transfer UserOp paying the Director invoice to the treasury.
 */

import type { Address } from 'viem'
import { getSuperfluidReceiverAddress } from '@/config/metoken'
import type { SmartWalletOp } from '@/hooks/use-smart-wallet-ops'
import { buildCrtvaiTransferOp } from '@/shared/web3/build-metoken-payment-op'

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

  return buildCrtvaiTransferOp(amountWei, treasury)
}
