import { toHex } from 'viem';
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains';

/**
 * Gas payment mode for Alchemy smart wallet operations.
 *
 * - "sponsorship" (default): the app's gas policy sponsors gas. Nothing extra
 *   is sent; Account Kit injects the policyId automatically.
 * - "erc20": the policy in VITE_ALCHEMY_POLICY_ID is an ERC-20 paymaster
 *   policy (users pay gas in USDC). wallet_prepareCalls must then include the
 *   `erc20` capability or Alchemy rejects sponsorship with
 *   "Policy ... is of type ERC20, but erc20 capability is missing".
 */
const policyId = import.meta.env.VITE_ALCHEMY_POLICY_ID as string | undefined;

const gasPolicyType = (
  import.meta.env.VITE_ALCHEMY_GAS_POLICY_TYPE as string | undefined
)?.toLowerCase();

/** Cap on USDC spent on gas per user operation (6 decimals). Default $1. */
const DEFAULT_MAX_GAS_USDC6 = 1_000_000n;

function getMaxGasUsdc6(): bigint {
  const raw = import.meta.env.VITE_ALCHEMY_GAS_MAX_USDC6 as string | undefined;
  if (raw && /^\d+$/.test(raw)) return BigInt(raw);
  return DEFAULT_MAX_GAS_USDC6;
}

export interface Erc20PaymasterCapabilities {
  paymasterService: {
    policyId: string;
    erc20: {
      tokenAddress: `0x${string}`;
      maxTokenAmount: `0x${string}`;
      postOpSettings: { autoApprove: true };
    };
  };
}

/**
 * Capabilities for wallet_prepareCalls when using an ERC-20 gas policy.
 * Returns null in sponsorship mode (default) so Account Kit's automatic
 * policyId injection applies unchanged.
 */
export function buildGasPaymasterCapabilities(
  chainId: number
): Erc20PaymasterCapabilities | null {
  if (gasPolicyType !== 'erc20' || !policyId) return null;
  const tokenAddress = USDC_ADDRESS_BY_CHAIN_ID[chainId];
  if (!tokenAddress) return null;
  return {
    paymasterService: {
      policyId,
      erc20: {
        tokenAddress,
        maxTokenAmount: toHex(getMaxGasUsdc6()),
        postOpSettings: { autoApprove: true },
      },
    },
  };
}
