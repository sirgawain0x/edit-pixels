import {
  SessionKeyAccessListType,
  SessionKeyPermissionsBuilder,
} from '@account-kit/smart-contracts';
import { encodeFunctionData, parseAbi } from 'viem';
import {
  DAILY_SPEND_LIMIT_USDC6,
  SPEND_LIMIT_REFRESH_SECONDS,
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
 * Builds session key permissions for "Pay AI Render" only:
 * - Allowlist the payment contract and payAiRender(uint256) selector.
 * - ERC-20 spend limit: 50 USDC rolling per day (DAILY_SPEND_LIMIT_USDC6).
 * Use the returned encoded permissions with addSessionKey / installSessionKeyPlugin
 * when using Modular Account V2. Same API key (VITE_ALCHEMY_API_KEY) must be used
 * for the client so Smart Account address is deterministic.
 */
export function buildPayAiRenderSessionKeyPermissions(): `0x${string}`[] {
  const paymentContract = getPaymentContractAddress();
  const usdcAddress = USDC_ADDRESS_BY_CHAIN_ID[ARBITRUM_ONE_CHAIN_ID];
  if (!paymentContract || !usdcAddress) {
    throw new Error(
      'VITE_ARBITRUM_PAYMENT_CONTRACT must be set to build session key permissions'
    );
  }

  const builder = new SessionKeyPermissionsBuilder();
  builder.setContractAccessControlType(SessionKeyAccessListType.ALLOWLIST);
  builder.addContractAddressAccessEntry({
    contractAddress: paymentContract,
    isOnList: true,
    checkSelectors: true,
  });
  builder.addContractFunctionAccessEntry({
    contractAddress: paymentContract,
    methodSelector: getPayAiRenderSelector(),
    isOnList: true,
  });
  builder.addErc20TokenSpendLimit({
    tokenAddress: usdcAddress,
    spendLimit: BigInt(DAILY_SPEND_LIMIT_USDC6),
    refreshInterval: SPEND_LIMIT_REFRESH_SECONDS,
  });

  return builder.encode() as `0x${string}`[];
}
