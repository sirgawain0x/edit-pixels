import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains'
import { ALCHEMY_GAS_MAX_USDC6, ALCHEMY_GAS_POLICY_TYPE, ALCHEMY_POLICY_ID } from '@/config/alchemy'

/**
 * Gas payment mode for Alchemy smart wallet operations.
 *
 * - "sponsorship" (default): the app's gas policy sponsors gas. Nothing extra
 *   is sent; the global policyId is attached at client-creation time.
 * - "erc20": the policy in VITE_ALCHEMY_POLICY_ID is an ERC-20 paymaster
 *   policy (users pay gas in USDC). prepareCalls must then include the `erc20`
 *   capability under `paymaster` or Alchemy rejects sponsorship with
 *   "Policy ... is of type ERC20, but erc20 capability is missing".
 */

/** Cap on USDC spent on gas per user operation (6 decimals). Default $1. */
export const DEFAULT_MAX_GAS_USDC6 = 1_000_000

/**
 * USDC (6 decimals) a balance check holds back for ERC-20 gas.
 * The paymaster cap is a charge ceiling; recent Base user operations cost a few cents.
 */
const PURCHASE_GAS_RESERVE_USDC6 = 50_000

/** Extra USDC (6 decimals) to reserve so an ERC-20 paymaster can collect gas. */
export function getPurchaseGasBufferUsdc6(chainId: number): number {
  if (ALCHEMY_GAS_POLICY_TYPE !== 'erc20' || !ALCHEMY_POLICY_ID) return 0
  if (!(chainId in USDC_ADDRESS_BY_CHAIN_ID)) return 0
  return PURCHASE_GAS_RESERVE_USDC6
}

export interface Erc20PaymasterCapabilities {
  paymaster: {
    policyId: string
    erc20: {
      tokenAddress: `0x${string}`
      maxTokenAmount: bigint
      postOpSettings: { autoApprove: true }
    }
  }
}

/**
 * Capabilities for prepareCalls when using an ERC-20 gas policy.
 * Returns null in sponsorship mode (default) so the global client-level
 * policy applies automatically.
 */
export function buildGasPaymasterCapabilities(chainId: number): Erc20PaymasterCapabilities | null {
  if (ALCHEMY_GAS_POLICY_TYPE !== 'erc20' || !ALCHEMY_POLICY_ID) return null
  const tokenAddress = USDC_ADDRESS_BY_CHAIN_ID[chainId]
  if (!tokenAddress) return null
  return {
    paymaster: {
      policyId: ALCHEMY_POLICY_ID,
      erc20: {
        tokenAddress,
        maxTokenAmount: BigInt(ALCHEMY_GAS_MAX_USDC6),
        postOpSettings: { autoApprove: true },
      },
    },
  }
}
