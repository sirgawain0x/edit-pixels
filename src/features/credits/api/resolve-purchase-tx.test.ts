import { describe, expect, it } from 'vitest';
import { rankCreditsPurchaseTxHashes } from './resolve-purchase-tx';

describe('rankCreditsPurchaseTxHashes', () => {
  it('returns empty array for no hashes', async () => {
    expect(await rankCreditsPurchaseTxHashes([])).toEqual([]);
  });

  it('returns single hash unchanged', async () => {
    const hash =
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const;
    expect(await rankCreditsPurchaseTxHashes([hash])).toEqual([hash]);
  });

  it('preserves all candidates without picking a silent fallback', async () => {
    const a =
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
    const b =
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
    const ranked = await rankCreditsPurchaseTxHashes([a, b]);
    expect(ranked).toHaveLength(2);
    expect(ranked).toContain(a);
    expect(ranked).toContain(b);
  });
});
