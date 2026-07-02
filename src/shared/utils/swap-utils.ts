/**
 * Encode a decimal amount (e.g. "1.5") to a bigint wei value.
 * 1 USDC (6 decimals) = 1_000_000n, 1 ETH (18 decimals) = 1_000_000_000_000_000_000n.
 */
export function decimalAmountToWei(amount: string, decimals: number): bigint {
  const parsed = parseFloat(amount);
  if (Number.isNaN(parsed) || parsed < 0) return 0n;
  const factor = 10 ** decimals;
  return BigInt(Math.floor(parsed * factor));
}

/**
 * Encode a decimal amount (e.g. "1.5") to hex for Alchemy swap API.
 * Values are passed as hex; 1 USDC (6 decimals) = 0xF4240, 1 ETH (18 decimals) = 0xDE0B6B3A7640000.
 * @deprecated Prefer `decimalAmountToWei` for v5 requestQuoteV0, which expects bigint amounts.
 */
export function decimalAmountToHex(amount: string, decimals: number): `0x${string}` {
  const wei = decimalAmountToWei(amount, decimals);
  return `0x${wei.toString(16)}` as `0x${string}`;
}

/** Native token address used by Alchemy for ETH / chain native token. */
export const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEee' as const;

/** Format chain ID as hex string for legacy APIs (e.g. 84532 -> "0x14a34"). */
export function chainIdToHex(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}` as `0x${string}`;
}
