/**
 * Billing constants for Live AI render (USDC, 6 decimals).
 * Premium = Creative Organization DAO members (Unlock on Base).
 * Retail = non-members.
 */
export const USDC_DECIMALS = 6;

/** $0.125 USDC per 5-minute interval (premium / cost basis). */
export const INTERVAL_COST_PREMIUM_USDC6 = 125_000;

/** $0.25 USDC per 5-minute interval (retail). */
export const INTERVAL_COST_RETAIL_USDC6 = 250_000;

/**
 * Rolling daily USDC spend cap for the Session Key (50 USDC = $50/day).
 * Resets every SPEND_LIMIT_REFRESH_SECONDS. At the $1.50/hr premium rate this
 * covers ~33 hrs/day of Live AI before re-authorization is required.
 *
 * Note: users who authorized a session key under the previous per-session $10
 * cap will continue to hit that cap until they re-authorize.
 */
export const DAILY_SPEND_LIMIT_USDC6 = 50_000_000;

/** Session Key spend-limit refresh period: 1 day in seconds. */
export const SPEND_LIMIT_REFRESH_SECONDS = 86_400;

/** Payment contract on Arbitrum (env: VITE_ARBITRUM_PAYMENT_CONTRACT). */
export function getPaymentContractAddress(): `0x${string}` | undefined {
  const v = import.meta.env.VITE_ARBITRUM_PAYMENT_CONTRACT as string | undefined;
  if (!v || !v.startsWith('0x')) return undefined;
  return v as `0x${string}`;
}

/** Stylus Style Registry on Arbitrum (env: VITE_STYLUS_STYLE_REGISTRY). Phase 2: style_id → creator for royalties. */
export function getStyleRegistryAddress(): `0x${string}` | undefined {
  const v = import.meta.env.VITE_STYLUS_STYLE_REGISTRY as string | undefined;
  if (!v || !v.startsWith('0x')) return undefined;
  return v as `0x${string}`;
}
