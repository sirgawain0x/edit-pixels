/**
 * Pixels payment UI — layered currency labeling:
 *
 * Layer 1 (pricing): `$` for rates, subscriptions, marketing — e.g. `$30/mo`, `$3/hr`
 * Layer 2 (wallet): `USDC` label for balances — e.g. `USDC: 12.50`
 * Layer 3 (actions): `USDC` in CTA labels — e.g. `Buy USDC`, `Buy credits`
 * Layer 4 (checkout): USDC amount with optional peg hint — e.g. `5 USDC (~$5)`
 *
 * Never combine as `$5 USDC` (redundant). Pick one layer per surface.
 */

import {
  DAILY_SPEND_LIMIT_USDC6,
  INTERVAL_COST_PREMIUM_USDC6,
  INTERVAL_COST_RETAIL_USDC6,
} from '@/config/billing';
import { hourlyUsdcFromInterval } from '@/config/superfluid';

/** Pixels Premium subscription (Unlock checkout — USDC or card). */
export const PIXELS_PREMIUM_MONTHLY_USD = 30;

export const LIVE_AI_PREMIUM_HOURLY_USD = hourlyUsdcFromInterval(
  INTERVAL_COST_PREMIUM_USDC6
);
export const LIVE_AI_RETAIL_HOURLY_USD = hourlyUsdcFromInterval(
  INTERVAL_COST_RETAIL_USDC6
);
export const LIVE_AI_DAILY_SPEND_CAP_USD = DAILY_SPEND_LIMIT_USDC6 / 1_000_000;

function formatUsdNumber(
  amount: number,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  });
}

/** Layer 1 — familiar dollar price anchor. */
export function formatUsdPrice(amount: number): string {
  return `$${formatUsdNumber(amount)}`;
}

/** Layer 1 — rate with unit suffix. */
export function formatUsdRate(amount: number, unit: string): string {
  return `${formatUsdPrice(amount)}/${unit}`;
}

/** Layer 1 — subscription CTA label. */
export function formatSubscribeCta(
  amountUsd = PIXELS_PREMIUM_MONTHLY_USD
): string {
  return `Subscribe ${formatUsdRate(amountUsd, 'mo')}`;
}

/** Layer 2/4 — on-chain token amount. */
export function formatUsdcAmount(amount: number): string {
  return `${formatUsdNumber(amount, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} USDC`;
}

/** Layer 4 — checkout confirmation with USD peg hint. */
export function formatUsdcCheckout(amount: number): string {
  return `${formatUsdcAmount(amount)} (~${formatUsdPrice(amount)})`;
}

/** Layer 4 — approximate USDC required (includes gas buffer). */
export function formatUsdcRequiredApprox(amount: number): string {
  return `~${formatUsdcAmount(amount)}`;
}

/** Layer 4 — streamed spend with USDC settlement context. */
export function formatUsdStreamedInUsdc(amount: number): string {
  return `~${formatUsdPrice(amount)} streamed in USDC`;
}
