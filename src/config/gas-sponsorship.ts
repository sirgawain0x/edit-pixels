import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains';

/**
 * Gas payment mode for Alchemy smart wallet operations.
 *
 * - "sponsorship" (default): the app's gas policy sponsors gas. Nothing extra
 *   is sent; the global policyId is attached at client-creation time.
 * - "erc20": the policy in VITE_ALCHEMY_POLICY_ID is an ERC-20 paymaster
 *   policy (users pay gas in USDC). v5 prepareCalls / requestQuoteV0 must then
 *   include the `erc20` capability under `paymaster` or Alchemy rejects
 *   sponsorship with "Policy ... is of type ERC20, but erc20 capability is
 *   missing".
 */
const policyId = import.meta.env.VITE_ALCHEMY_POLICY_ID as string | undefined;

const gasPolicyType = (
  import.meta.env.VITE_ALCHEMY_GAS_POLICY_TYPE as string | undefined
)?.toLowerCase();

/** Cap on USDC spent on gas per user operation (6 decimals). Default $1. */
export const DEFAULT_MAX_GAS_USDC6 = 1_000_000;

function getMaxGasUsdc6(): bigint {
  const raw = import.meta.env.VITE_ALCHEMY_GAS_MAX_USDC6 as string | undefined;
  if (raw && /^\d+$/.test(raw)) return BigInt(raw);
  return BigInt(DEFAULT_MAX_GAS_USDC6);
}

/** Extra USDC (6 decimals) to reserve for ERC-20 gas when buying credit packs. */
export function getPurchaseGasBufferUsdc6(chainId: number): number {
  if (gasPolicyType !== 'erc20' || !policyId) return 0;
  if (!(chainId in USDC_ADDRESS_BY_CHAIN_ID)) return 0;
  return Number(getMaxGasUsdc6());
}

export interface Erc20PaymasterCapabilities {
  paymaster: {
    policyId: string;
    erc20: {
      tokenAddress: `0x${string}`;
      maxTokenAmount: bigint;
      postOpSettings: { autoApprove: true };
    };
  };
}

/**
 * Capabilities for v5 prepareCalls / requestQuoteV0 when using an ERC-20 gas
 * policy. Returns null in sponsorship mode (default) so the global client-level
 * policy applies automatically.
 */
export function buildGasPaymasterCapabilities(
  chainId: number
): Erc20PaymasterCapabilities | null {
  if (gasPolicyType !== 'erc20' || !policyId) return null;
  const tokenAddress = USDC_ADDRESS_BY_CHAIN_ID[chainId];
  if (!tokenAddress) return null;
  return {
    paymaster: {
      policyId,
      erc20: {
        tokenAddress,
        maxTokenAmount: getMaxGasUsdc6(),
        postOpSettings: { autoApprove: true },
      },
    },
  };
}
