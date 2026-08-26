/**
 * Shared Flow / generative billing — CRTVAI transfer verify + consume (anti-replay).
 */
// fallow-ignore-file unused-export,complexity,code-duplication

import {
  isDirectorBillingEnforced,
  quoteDirectorRetail,
  verifyAndConsumeDirectorPayment,
  type DirectorBillingQuote,
  type PaymentVerifyResult,
} from './director-billing.js'

export { isDirectorBillingEnforced as isFlowBillingEnforced, type PaymentVerifyResult }

/** Convert legacy Flow credits ($0.10/credit) to usdc6 + min CRTVAI wei. */
export function quoteFlowCreditsUsdc6(credits: number): {
  estimatedUsdc6: number
  minCrtvaiWei: bigint
} | null {
  if (!Number.isFinite(credits) || credits <= 0) return null
  const estimatedUsdc6 = Math.max(1, Math.ceil(credits)) * 100_000
  return {
    estimatedUsdc6,
    minCrtvaiWei: BigInt(estimatedUsdc6) * 10n ** 12n,
  }
}

export function quoteDirectorForReuse(audioDurationSeconds: number): DirectorBillingQuote | null {
  return quoteDirectorRetail(audioDurationSeconds)
}

/** Verify treasury transfer and mark tx consumed for `purpose`. */
export async function verifyFlowPayment(options: {
  txHash: string
  from: string
  minAmountWei: bigint
  purpose?: string
}): Promise<PaymentVerifyResult> {
  return verifyAndConsumeDirectorPayment({
    txHash: options.txHash,
    from: options.from,
    minAmountWei: options.minAmountWei,
    purpose: options.purpose ?? 'flow',
  })
}
