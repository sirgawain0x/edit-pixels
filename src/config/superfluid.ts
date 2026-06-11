import { arbitrum } from 'viem/chains';

/** CFAv1Forwarder — same address on all Superfluid networks. */
export const CFA_FORWARDER_ADDRESS =
  '0xcfA132E353cB4E398080B9700609bb008eceB125' as const;

/**
 * USDCx on Arbitrum One (Super Token wrapping native USDC).
 * @see https://docs.superfluid.finance
 */
export const USDCX_ARBITRUM_ADDRESS =
  '0x1B685Db6F26e40E0679CA90f10Bd952646299679' as const;

export const SUPERFLUID_CHAIN_ID = arbitrum.id;

/** Seconds per billing interval (matches legacy 5-minute interval pricing). */
export const BILLING_INTERVAL_SECONDS = 300;

/** Minimum USDC (6 decimals) required on Arbitrum to start Live AI (one billing interval). */
export function minStartUsdc6(intervalCostUsdc6: number): number {
  return intervalCostUsdc6;
}

/** USDC (6 dec) wrapped for one hour of streaming at the given interval rate. */
export function wrapUsdc6ForOneHour(intervalCostUsdc6: number): bigint {
  return BigInt(intervalCostUsdc6 * 12);
}

/**
 * Superfluid flow rate (super-token wei per second, 18 decimals).
 * Derived from USDC6 per billing interval.
 */
export function intervalCostUsdc6ToFlowRate(intervalCostUsdc6: number): bigint {
  const numerator = BigInt(intervalCostUsdc6) * 10n ** 12n;
  const interval = BigInt(BILLING_INTERVAL_SECONDS);
  return (numerator + interval - 1n) / interval;
}

/** Convert USDC6 amount to super-token wei (18 decimals). */
export function usdc6ToSuperTokenWei(usdc6: bigint | number): bigint {
  return BigInt(usdc6) * 10n ** 12n;
}

/** Treasury / receiver for Live AI streams (env: VITE_SUPERFLUID_RECEIVER). */
export function getSuperfluidReceiverAddress(): `0x${string}` | undefined {
  const v = import.meta.env.VITE_SUPERFLUID_RECEIVER as string | undefined;
  if (!v || !v.startsWith('0x')) return undefined;
  return v as `0x${string}`;
}

export function isSuperfluidConfigured(): boolean {
  return Boolean(getSuperfluidReceiverAddress());
}

/** Hourly USDC cost from interval pricing (for UI). */
export function hourlyUsdcFromInterval(intervalCostUsdc6: number): number {
  return (intervalCostUsdc6 * 12) / 1_000_000;
}
