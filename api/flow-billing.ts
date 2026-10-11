/**
 * Shared Flow / generative billing — CRTVAI transfer verify + consume (anti-replay).
 */
// fallow-ignore-file unused-export,complexity,code-duplication

import {
  isDirectorBillingEnforced,
  quoteDirectorRetail,
  releaseDirectorPayment,
  verifyAndConsumeDirectorPayment,
  type DirectorBillingQuote,
  type PaymentVerifyResult,
} from './director-billing.js'
import { MetokenQuoteError, quoteCrtvaiForUsdc6 } from './_metoken-curve-quote.js'

export { isDirectorBillingEnforced as isFlowBillingEnforced, type PaymentVerifyResult }

export interface FlowCreditsQuote {
  quoteId: string
  signature: string
  expiresAtMs: number
  slippageBps: number
  estimatedUsdc6: number
  minCrtvaiWei: bigint
}

/** Convert legacy Flow credits ($0.10/credit) to usdc6 + live-curve CRTVAI wei. */
export async function quoteFlowCreditsUsdc6(credits: number): Promise<FlowCreditsQuote | null> {
  if (!Number.isFinite(credits) || credits <= 0) return null
  const estimatedUsdc6 = Math.max(1, Math.ceil(credits)) * 100_000
  try {
    const curve = await quoteCrtvaiForUsdc6(estimatedUsdc6)
    return {
      quoteId: curve.quoteId,
      signature: curve.signature,
      expiresAtMs: curve.expiresAtMs,
      slippageBps: curve.slippageBps,
      estimatedUsdc6,
      minCrtvaiWei: curve.minCrtvaiWei,
    }
  } catch (error) {
    if (error instanceof MetokenQuoteError) return null
    throw error
  }
}

export async function quoteDirectorForReuse(
  audioDurationSeconds: number,
): Promise<DirectorBillingQuote | null> {
  return quoteDirectorRetail(audioDurationSeconds)
}

/** Undo a consumed payment hash after a pre-delivery generative failure. */
export async function releaseFlowPayment(txHash: string): Promise<void> {
  await releaseDirectorPayment(txHash)
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
