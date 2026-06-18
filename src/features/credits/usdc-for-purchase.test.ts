import { describe, expect, it } from 'vitest';
import { CREDIT_PACKS } from '@/config/credits';
import {
  canAffordAnyCreditPack,
  hasEnoughUsdcForPack,
} from '@/features/credits/usdc-for-purchase';

describe('usdc-for-purchase', () => {
  const starterPack = CREDIT_PACKS[0]!;

  it('affirms Starter pack affordable at 11.52 USDC', () => {
    expect(hasEnoughUsdcForPack('11.52', starterPack)).toBe(true);
    expect(canAffordAnyCreditPack('11.52')).toBe(true);
  });

  it('rejects packs when balance is null (loading)', () => {
    expect(hasEnoughUsdcForPack(null, starterPack)).toBe(false);
    expect(canAffordAnyCreditPack(null)).toBe(false);
  });

  it('rejects Starter when balance is below pack price', () => {
    expect(hasEnoughUsdcForPack('4.99', starterPack)).toBe(false);
    expect(canAffordAnyCreditPack('4.99')).toBe(false);
  });

  it('affirms all packs at 50 USDC', () => {
    for (const pack of CREDIT_PACKS) {
      expect(hasEnoughUsdcForPack('50', pack)).toBe(true);
    }
  });
});
