/**
 * Capped spend authorization for Live Style (pay-as-you-go).
 *
 * Wallet stack: Privy signer + Alchemy ERC-4337 smart account (sma-b).
 * Coinbase Spend Permissions target Coinbase smart wallets — not used here.
 * Permit2 is reserved for a future spender contract integration.
 */
import type { Address } from 'viem'
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains'
import type { LiveStyleCapPresetUsd } from '@/features/live-style/lib/config'
import { capPresetToUsdc6 } from '@/features/live-style/lib/config'
import type { LiveStyleSpendAuthMethod } from '@/features/live-style/lib/payment/types'
import { buildErc20ApproveOp } from '@/features/live-style/wallet/build-erc20-approve-op'
import type { SmartWalletOp } from '@/hooks/use-smart-wallet-ops'

export const LIVE_STYLE_PAYMENT_SPENDER_PLACEHOLDER =
  '0x0000000000000000000000000000000000000001' as Address

export function preferredLiveStyleSpendAuthMethod(): LiveStyleSpendAuthMethod {
  return 'erc20-approve'
}

export function buildLiveStyleCapApprovalOps(input: {
  chainId: number
  capPresetUsd: LiveStyleCapPresetUsd
  spender?: Address
}): SmartWalletOp[] {
  const token = USDC_ADDRESS_BY_CHAIN_ID[input.chainId]
  if (!token) throw new Error('USDC not configured for chain')
  const spender = input.spender ?? LIVE_STYLE_PAYMENT_SPENDER_PLACEHOLDER
  const amount = BigInt(capPresetToUsdc6(input.capPresetUsd))
  return [buildErc20ApproveOp(token, spender, amount)]
}

/** Proof stored server-side — tx hash from sendOps or signed permit payload. */
export function spendAuthProofFromTxHash(txHash: string): string {
  return txHash
}
