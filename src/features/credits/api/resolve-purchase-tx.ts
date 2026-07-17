import {
  type Hex,
} from 'viem';

/**
 * Orders batched smart-wallet receipt hashes for credit sync.
 * Credits system is deprecated — returns hashes unchanged.
 */
export async function rankCreditsPurchaseTxHashes(
  txHashes: readonly Hex[]
): Promise<Hex[]> {
  const unique = [...new Set(txHashes.filter(Boolean))];
  return unique;
}
