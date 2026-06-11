import { describe, expect, it } from 'vitest';
import {
  BILLING_INTERVAL_SECONDS,
  hourlyUsdcFromInterval,
  intervalCostUsdc6ToFlowRate,
  usdc6ToSuperTokenWei,
  wrapUsdc6ForOneHour,
} from './superfluid';
import {
  INTERVAL_COST_PREMIUM_USDC6,
  INTERVAL_COST_RETAIL_USDC6,
} from './billing';

describe('superfluid flow rates', () => {
  it('retail rate streams at least $3/hr in super-token wei', () => {
    const flowRate = intervalCostUsdc6ToFlowRate(INTERVAL_COST_RETAIL_USDC6);
    const oneHourWei = flowRate * 3600n;
    expect(oneHourWei).toBeGreaterThanOrEqual(usdc6ToSuperTokenWei(3_000_000));
    expect(oneHourWei).toBeLessThanOrEqual(
      usdc6ToSuperTokenWei(3_000_000) + 3600n * 10n ** 12n
    );
  });

  it('premium rate streams at least $1.50/hr', () => {
    const flowRate = intervalCostUsdc6ToFlowRate(INTERVAL_COST_PREMIUM_USDC6);
    const oneHourWei = flowRate * 3600n;
    expect(oneHourWei).toBeGreaterThanOrEqual(usdc6ToSuperTokenWei(1_500_000));
    expect(oneHourWei).toBeLessThanOrEqual(
      usdc6ToSuperTokenWei(1_500_000) + 3600n * 10n ** 12n
    );
  });

  it('wrap amount covers one hour at interval rate', () => {
    expect(wrapUsdc6ForOneHour(INTERVAL_COST_RETAIL_USDC6)).toBe(3_000_000n);
    expect(wrapUsdc6ForOneHour(INTERVAL_COST_PREMIUM_USDC6)).toBe(1_500_000n);
  });

  it('hourly display helper', () => {
    expect(hourlyUsdcFromInterval(INTERVAL_COST_RETAIL_USDC6)).toBe(3);
    expect(hourlyUsdcFromInterval(INTERVAL_COST_PREMIUM_USDC6)).toBe(1.5);
  });

  it('uses 5-minute billing intervals', () => {
    expect(BILLING_INTERVAL_SECONDS).toBe(300);
  });
});
