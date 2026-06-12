import type { CreditPackDefinition } from '@/config/credits';
import { CREDIT_PACKS } from '@/config/credits';
import { getPurchaseGasBufferUsdc6 } from '@/config/gas-sponsorship';

const ARBITRUM_ONE_CHAIN_ID = 42_161;

export function packUsdcRequiredUsdc6(pack: CreditPackDefinition): number {
  return pack.usdc6 + getPurchaseGasBufferUsdc6(ARBITRUM_ONE_CHAIN_ID);
}

export function hasEnoughUsdcForPack(
  usdcBalance: string | null,
  pack: CreditPackDefinition
): boolean {
  if (usdcBalance === null) return false;
  return Number(usdcBalance) * 1_000_000 >= packUsdcRequiredUsdc6(pack);
}

export function canAffordAnyCreditPack(usdcBalance: string | null): boolean {
  if (usdcBalance === null) return false;
  return CREDIT_PACKS.some((pack) => hasEnoughUsdcForPack(usdcBalance, pack));
}

export function formatUsdcRequiredForPack(pack: CreditPackDefinition): string {
  return (packUsdcRequiredUsdc6(pack) / 1_000_000).toFixed(2);
}

export function packUsdcAmount(pack: CreditPackDefinition): number {
  return pack.usdc6 / 1_000_000;
}
