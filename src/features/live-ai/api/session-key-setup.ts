import { encodeFunctionData, parseAbi } from 'viem';
import {
  getPaymentContractAddress,
} from '@/config/billing';
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains';

const PAY_AI_RENDER_ABI = parseAbi([
  'function payAiRender(uint256 amountUsdc6) external',
]);

/** Arbitrum One chain id (billing chain). */
export const ARBITRUM_ONE_CHAIN_ID = 42_161;

/**
 * 4-byte selector for payAiRender(uint256) for Session Key contract allowlist.
 */
export function getPayAiRenderSelector(): `0x${string}` {
  const encoded = encodeFunctionData({
    abi: PAY_AI_RENDER_ABI,
    functionName: 'payAiRender',
    args: [0n],
  });
  return encoded.slice(0, 10) as `0x${string}`;
}

/**
 * Builds session key permissions for "Pay AI Render" only.
 *
 * NOTE: The previous @account-kit/smart-contracts SessionKeyPermissionsBuilder
 * dependency was removed during the Alchemy v5 + Privy migration. Session keys
 * are not currently wired to a v5 API, so this function returns a placeholder
 * that preserves the historical shape but throws if called. If you need live
 * session-key support, implement it via the Alchemy wallet-apis permissions
 * actions and update the caller.
 */
export function buildPayAiRenderSessionKeyPermissions(): `0x${string}`[] {
  const paymentContract = getPaymentContractAddress();
  const usdcAddress = USDC_ADDRESS_BY_CHAIN_ID[ARBITRUM_ONE_CHAIN_ID];
  if (!paymentContract || !usdcAddress) {
    throw new Error(
      'VITE_ARBITRUM_PAYMENT_CONTRACT must be set to build session key permissions'
    );
  }
  throw new Error(
    'Session key permissions builder is not yet implemented for Alchemy v5 + Privy. Use smart-wallet batched calls instead.'
  );
}
