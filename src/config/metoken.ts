import { parseAbi } from 'viem';
import { base } from 'viem/chains';
import { getBasePublicClient } from '@/config/base-client';

/**
 * CRTVAI MeToken — Creative TV's AI payment token.
 *
 * Diamond ERC-2535 contract on Base, backed by USDC via Bancor Zero formula.
 * Users mint CRTVAI by sending USDC to the meToken contract; the bonding curve
 * determines how many meTokens they receive. They can sell (burn) meTokens
 * back into USDC at the current curve price.
 *
 * Diamond address: 0xecb695544a3d2a64d579b3828f3f60f6932f4846
 * Hub ID: 2 (USDC-backed, curve params fixed: baseY=224, reserveWeight=32)
 * Underlying asset: USDC on Base (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
 */

/** CRTVAI meToken diamond address on Base. */
export const CRTVAI_DIAMOND_ADDRESS =
  '0xecb695544a3d2a64d579b3828f3f60f6932f4846' as const;

/** MeToken hub ID for CRTVAI (USDC-backed hub on Base). */
export const CRTVAI_HUB_ID = 2;

/** USDC on Base mainnet (native USDC, 6 decimals). */
export const USDC_BASE_ADDRESS =
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

/** USDC decimals (same across chains). */
export const USDC_DECIMALS = 6;

/** CRTVAI meToken decimals (meTokens use 18). */
export const CRTVAI_DECIMALS = 18;

/**
 * Wrapped Super Token address for CRTVAI on Base (CRTVAIx).
 * Set via env VITE_CRTVAIX_ADDRESS after deploying the Wrapped Super Token.
 * Required for Live AI streaming via Superfluid.
 */
export function getCrtvaiXAddress(): `0x${string}` | undefined {
  const v = import.meta.env.VITE_CRTVAIX_ADDRESS as string | undefined;
  if (!v || !v.startsWith('0x')) return undefined;
  return v as `0x${string}`;
}

/** Treasury / receiver for Live AI streams on Base (env: VITE_SUPERFLUID_RECEIVER). */
export function getSuperfluidReceiverAddress(): `0x${string}` | undefined {
  const v = import.meta.env.VITE_SUPERFLUID_RECEIVER as string | undefined;
  if (!v || !v.startsWith('0x')) return undefined;
  return v as `0x${string}`;
}

export function isSuperfluidConfigured(): boolean {
  return Boolean(getSuperfluidReceiverAddress() && getCrtvaiXAddress());
}

/** Chain ID for Superfluid streaming (Base). */
export const SUPERFLUID_CHAIN_ID = base.id;

/** Seconds per billing interval (matches 5-minute interval pricing). */
export const BILLING_INTERVAL_SECONDS = 300;

/** Minimum CRTVAI (in meToken wei, 18 decimals) required to start Live AI (one billing interval). */
export function minStartMetokenWei(intervalCostUsdc6: number): bigint {
  // Convert USDC6 cost to meToken wei using 12-decimal multiplier (18 - 6 = 12)
  return BigInt(intervalCostUsdc6) * 10n ** 12n;
}

/** CRTVAI meToken wei (18 decimals) wrapped for one hour of streaming. */
export function wrapMetokenWeiForOneHour(intervalCostUsdc6: number): bigint {
  return BigInt(intervalCostUsdc6) * 10n ** 12n * 12n;
}

/**
 * Superfluid flow rate (super-token wei per second, 18 decimals).
 * Derived from USDC6-equivalent per billing interval.
 */
export function intervalCostUsdc6ToFlowRate(intervalCostUsdc6: number): bigint {
  const numerator = BigInt(intervalCostUsdc6) * 10n ** 12n;
  const interval = BigInt(BILLING_INTERVAL_SECONDS);
  return (numerator + interval - 1n) / interval;
}

/** Convert USDC6 amount to meToken wei (18 decimals). */
export function usdc6ToMetokenWei(usdc6: bigint | number): bigint {
  return BigInt(usdc6) * 10n ** 12n;
}

/** Hourly USDC-equivalent cost from interval pricing (for UI). */
export function hourlyUsdcFromInterval(intervalCostUsdc6: number): number {
  return (intervalCostUsdc6 * 12) / 1_000_000;
}

// ── MeToken Diamond ABI (ERC-2535 facets) ──────────────────────────

/** ERC-20 facet — standard token interface for balanceOf, transfer, etc. */
export const METOKEN_ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

/** MeToken facet — mint, sell, and curve pricing. */
export const METOKEN_DIAMOND_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function mint(uint256 amount) external',
  'function sell(uint256 amount) external',
  'function getCurrentPrice() view returns (uint256)',
  'function getMintPrice(uint256 amount) view returns (uint256)',
  'function getSellPrice(uint256 amount) view returns (uint256)',
  'function getHubId() view returns (uint256)',
  'function activeCollateralOnly() view returns (bool)',
]);

/** CFAv1Forwarder — same address on all Superfluid networks. */
export const CFA_FORWARDER_ADDRESS =
  '0xcfA132E353cB4E398080B9700609bb008eceB125' as const;

export const SUPER_TOKEN_ABI = parseAbi([
  'function upgrade(uint256 amount)',
  'function balanceOf(address account) view returns (uint256)',
]);

// ── Read helpers ───────────────────────────────────────────────────

/** Read CRTVAI meToken balance for an address on Base. */
export async function readCrtvaiBalance(
  address: `0x${string}`
): Promise<bigint> {
  const client = getBasePublicClient();
  return client.readContract({
    address: CRTVAI_DIAMOND_ADDRESS,
    abi: METOKEN_DIAMOND_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
}

/** Read current meToken mint price (USDC per meToken, in raw units). */
export async function readCrtvaiCurrentPrice(): Promise<bigint> {
  const client = getBasePublicClient();
  return client.readContract({
    address: CRTVAI_DIAMOND_ADDRESS,
    abi: METOKEN_DIAMOND_ABI,
    functionName: 'getCurrentPrice',
  });
}

/** Read estimated meToken output for a given USDC input amount. */
export async function readCrtvaiMintQuote(
  usdcAmount: bigint
): Promise<bigint> {
  const client = getBasePublicClient();
  return client.readContract({
    address: CRTVAI_DIAMOND_ADDRESS,
    abi: METOKEN_DIAMOND_ABI,
    functionName: 'getMintPrice',
    args: [usdcAmount],
  });
}

/** Read estimated USDC return for selling a given meToken amount. */
export async function readCrtvaiSellQuote(
  metokenAmount: bigint
): Promise<bigint> {
  const client = getBasePublicClient();
  return client.readContract({
    address: CRTVAI_DIAMOND_ADDRESS,
    abi: METOKEN_DIAMOND_ABI,
    functionName: 'getSellPrice',
    args: [metokenAmount],
  });
}