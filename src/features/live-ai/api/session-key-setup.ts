/**
 * @deprecated Session key setup for the old Arbitrum PaymentContract.
 * CRTVAI meToken on Base replaces this — use smart wallet batched calls.
 */

export const ARBITRUM_ONE_CHAIN_ID = 42_161;

export function getPayAiRenderSelector(): `0x${string}` {
  return '0x00000000' as `0x${string}`;
}

export function buildPayAiRenderSessionKeyPermissions(): `0x${string}`[] {
  throw new Error(
    'Session key permissions are deprecated. Use CRTVAI meToken on Base with smart wallet batched calls.'
  );
}