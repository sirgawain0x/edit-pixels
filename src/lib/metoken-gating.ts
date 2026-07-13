import { getBasePublicClient } from '@/config/base-client';
import { CRTVAI_DIAMOND_ADDRESS, METOKEN_DIAMOND_ABI } from '@/config/metoken';

/**
 * Returns true if the given address holds any CRTVAI meToken balance on Base.
 * Used to unlock gated styles in the UI and determine billing path.
 */
export async function checkMeTokenHolder(address: `0x${string}`): Promise<boolean> {
  const client = getBasePublicClient();
  const balance = await client.readContract({
    address: CRTVAI_DIAMOND_ADDRESS,
    abi: METOKEN_DIAMOND_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
  return balance > 0n;
}