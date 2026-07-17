import { encodeFunctionData, erc20Abi, parseAbi, parseUnits } from 'viem';
import { USDC_DECIMALS } from '@/config/billing';

const PAY_AI_RENDER_ABI = parseAbi([
  'function payAiRender(uint256 amountUsdc6) external',
  'function buyCredits(uint8 packId) external',
]);

export type PayAiRenderFailureReason =
  | 'insufficient_balance'
  | 'session_limit_exceeded'
  | 'rpc_or_unknown';

 
export function buildPayAiRenderCalldata(amountUsdc6: number): `0x${string}` | undefined {
  void amountUsdc6;
  return undefined;
}

export function buildBuyCreditsCalldata(packId: number): `0x${string}` | undefined {
  void packId;
  return undefined;
}

/**
 * Builds an ERC-20 approve call for the exact USDC amount of a credit pack.
 * Approving the exact pack price reduces exposure and avoids re-approval
 * issues when a prior unlimited approval was set to a different value.
 */
export function buildBuyCreditsApproveCalldata(
  paymentContract: `0x${string}`,
  packUsdc6: number
): `0x${string}` {
  const amount = parseUnits(String(packUsdc6 / 10 ** USDC_DECIMALS), USDC_DECIMALS);
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [paymentContract, amount],
  });
}

export function classifyPayFailure(error: unknown): PayAiRenderFailureReason {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  if (
    lower.includes('allowance') ||
    lower.includes('insufficient') ||
    lower.includes('balance') ||
    lower.includes('exceeds balance')
  ) {
    return 'insufficient_balance';
  }
  if (
    lower.includes('session') ||
    lower.includes('limit exceeded') ||
    lower.includes('spending limit') ||
    lower.includes('allowance exceeded')
  ) {
    return 'session_limit_exceeded';
  }
  return 'rpc_or_unknown';
}

export function getBuyCreditsSelector(): `0x${string}` {
  const encoded = encodeFunctionData({
    abi: PAY_AI_RENDER_ABI,
    functionName: 'buyCredits',
    args: [0],
  });
  return encoded.slice(0, 10) as `0x${string}`;
}
