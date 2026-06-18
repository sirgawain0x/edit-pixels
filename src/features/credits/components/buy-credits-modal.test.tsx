import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression: buy-credits modal must use LightAccount (same as wallet menu and
 * useCredits) so USDC balance matches the connected smart wallet.
 */
describe('BuyCreditsModal account type', () => {
  it('uses LightAccount for wallet address (not sca)', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, 'buy-credits-modal.tsx'),
      'utf8'
    );
    expect(source).toContain("useAccount({ type: 'LightAccount' })");
    expect(source).not.toContain("useAccount({ type: 'sca' })");
  });

  it('shows balance loading state while USDC is fetched', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, 'buy-credits-modal.tsx'),
      'utf8'
    );
    expect(source).toContain('Checking USDC balance');
    expect(source).toContain('isBalanceLoading');
  });
});
