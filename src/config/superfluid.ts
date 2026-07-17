import {
  CFA_FORWARDER_ADDRESS,
  SUPER_TOKEN_ABI,
  getCrtvaiXAddress,
  getSuperfluidReceiverAddress,
  isSuperfluidConfigured,
  SUPERFLUID_CHAIN_ID,
  BILLING_INTERVAL_SECONDS,
  intervalCostUsdc6ToFlowRate,
  usdc6ToMetokenWei,
  wrapMetokenWeiForOneHour,
  hourlyUsdcFromInterval,
} from '@/config/metoken';

// Re-export for backward compatibility with existing imports
export {
  CFA_FORWARDER_ADDRESS,
  SUPER_TOKEN_ABI,
  SUPERFLUID_CHAIN_ID,
  BILLING_INTERVAL_SECONDS,
  intervalCostUsdc6ToFlowRate,
  usdc6ToMetokenWei as usdc6ToSuperTokenWei,
  wrapMetokenWeiForOneHour as wrapUsdc6ForOneHour,
  hourlyUsdcFromInterval,
  getCrtvaiXAddress,
  getSuperfluidReceiverAddress,
  isSuperfluidConfigured,
};

/** CRTVAIx (Wrapped Super Token) address on Base. */
export function getSuperTokenAddress(): `0x${string}` | undefined {
  return getCrtvaiXAddress();
}