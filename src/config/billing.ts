/**
 * Billing constants for AI render payments.
 * Premium = Creative Organization DAO members (Unlock on Base).
 * Retail = non-members.
 *
 * All payments use CRTVAI meToken on Base. USDC is used only for onramping
 * (Coinbase onramp) and as the meToken's underlying collateral.
 */

/** USDC decimals (6) — used for price quoting and gas buffer calculations. */
export const USDC_DECIMALS = 6

/** $0.125 USDC-equivalent per 5-minute interval (premium / cost basis). */
export const INTERVAL_COST_PREMIUM_USDC6 = 125_000

/** $0.25 USDC-equivalent per 5-minute interval (retail). */
export const INTERVAL_COST_RETAIL_USDC6 = 250_000

/**
 * Rolling daily spend cap for the Session Key (50 USDC-equivalent = $50/day).
 * Resets every SPEND_LIMIT_REFRESH_SECONDS. At the $1.50/hr premium rate this
 * covers ~33 hrs/day of Live AI before re-authorization is required.
 */
export const DAILY_SPEND_LIMIT_USDC6 = 50_000_000

/** Session Key spend-limit refresh period: 1 day in seconds. */
export const SPEND_LIMIT_REFRESH_SECONDS = 86_400
