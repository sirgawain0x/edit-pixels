/**
 * Server-side credit pack definitions. Keep in sync with src/config/credits.ts
 * and contracts/arbitrum/PaymentContract.sol.
 */

export interface ServerCreditPack {
  id: number;
  usdc6: number;
  credits: number;
}

/** Must match on-chain PaymentContract pack ids (0, 1, 2). */
export const SERVER_CREDIT_PACKS: readonly ServerCreditPack[] = [
  { id: 0, usdc6: 5_000_000, credits: 50 },
  { id: 1, usdc6: 15_000_000, credits: 175 },
  { id: 2, usdc6: 40_000_000, credits: 500 },
] as const;

export function getServerCreditPack(packId: number): ServerCreditPack | undefined {
  return SERVER_CREDIT_PACKS.find((p) => p.id === packId);
}

/**
 * Validates CreditsPurchased event args against known pack config.
 */
export function validateCreditPurchaseEvent(
  packId: number,
  credits: number,
  usdcPaid: number
): boolean {
  const pack = getServerCreditPack(packId);
  if (!pack) return false;
  return pack.credits === credits && pack.usdc6 === usdcPaid;
}
