/**
 * CRTVAI billing for Seedance — quote → reserve → settle.
 *
 * Full meToken burn wiring is TODO; payment verification reuses Flow/Director
 * treasury transfer checks when billing is enforced.
 */
// fallow-ignore-file unused-export

import { randomUUID } from 'node:crypto'
import {
  clampSeedanceDuration,
  quoteSeedanceMinCrtvaiWei,
  quoteSeedanceUsdc6,
  type SeedanceResolution,
} from './_seedance-pricing.js'
import { isFlowBillingEnforced, verifyFlowPayment, type PaymentVerifyResult } from './flow-billing.js'

export interface SeedanceBillingQuote {
  quoteId: string
  duration: number
  resolution: SeedanceResolution
  estimatedUsdc6: number
  minCrtvaiWei: bigint
}

export interface SeedanceBillingReservation {
  reservationId: string
  quoteId: string
  wallet: string
  expiresAtMs: number
}

const memoryQuotes = new Map<string, SeedanceBillingQuote>()
const memoryReservations = new Map<string, SeedanceBillingReservation>()

const QUOTE_TTL_MS = 15 * 60 * 1000

/** Price a Seedance job at undiscounted Higgsfield list rates. */
export function quoteSeedanceSpend(input: {
  duration: number
  resolution: SeedanceResolution
}): SeedanceBillingQuote {
  const duration = clampSeedanceDuration(input.duration)
  const resolution = input.resolution === '480p' ? '480p' : '720p'
  const estimatedUsdc6 = quoteSeedanceUsdc6({ duration, resolution })
  const quote: SeedanceBillingQuote = {
    quoteId: randomUUID(),
    duration,
    resolution,
    estimatedUsdc6,
    minCrtvaiWei: quoteSeedanceMinCrtvaiWei(estimatedUsdc6),
  }
  memoryQuotes.set(quote.quoteId, quote)
  return quote
}

/** TODO: persist reservations in Redis when CRTVAI burn is wired. */
export function reserveSeedanceSpend(
  quoteId: string,
  wallet: string,
): SeedanceBillingReservation | null {
  const quote = memoryQuotes.get(quoteId.trim())
  if (!quote) return null
  const reservation: SeedanceBillingReservation = {
    reservationId: randomUUID(),
    quoteId: quote.quoteId,
    wallet: wallet.trim().toLowerCase(),
    expiresAtMs: Date.now() + QUOTE_TTL_MS,
  }
  memoryReservations.set(reservation.reservationId, reservation)
  return reservation
}

/** TODO: settle reserved CRTVAI against on-chain burn receipt. */
export function settleSeedanceSpend(_reservationId: string): void {
  // Stub — treasury transfer verify handles spend gating for v1.
}

export function getSeedanceQuote(quoteId: string): SeedanceBillingQuote | null {
  return memoryQuotes.get(quoteId.trim()) ?? null
}

export function isSeedanceBillingEnforced(): boolean {
  return isFlowBillingEnforced()
}

export async function verifySeedancePayment(options: {
  txHash: string
  from: string
  minAmountWei: bigint
}): Promise<PaymentVerifyResult> {
  return verifyFlowPayment({
    txHash: options.txHash,
    from: options.from,
    minAmountWei: options.minAmountWei,
    purpose: 'seedance-generate',
  })
}
