/**
 * CRTVAI billing for Seedance — quote → reserve → settle.
 *
 * Quotes and reservations persist in Redis on Vercel (memory fallback locally).
 * Spend gating uses treasury transfer verify (same as Flow/Director). On-chain
 * meToken burn wiring remains a future enhancement.
 */
// fallow-ignore-file unused-export,complexity

import { randomUUID } from 'node:crypto'
import { getRedis, isRedisConfigured } from './_redis-client.js'
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
  settled?: boolean
}

const QUOTE_KEY_PREFIX = 'pixels:seedance:quote:'
const RESERVATION_KEY_PREFIX = 'pixels:seedance:reservation:'
const QUOTE_TTL_SECONDS = 15 * 60

const memoryQuotes = new Map<string, SeedanceBillingQuote>()
const memoryReservations = new Map<string, SeedanceBillingReservation>()

function allowMemoryFallback(): boolean {
  return !process.env.VERCEL
}

interface StoredQuote {
  quoteId: string
  duration: number
  resolution: SeedanceResolution
  estimatedUsdc6: number
  minCrtvaiWei: string
}

function toStoredQuote(quote: SeedanceBillingQuote): StoredQuote {
  return {
    quoteId: quote.quoteId,
    duration: quote.duration,
    resolution: quote.resolution,
    estimatedUsdc6: quote.estimatedUsdc6,
    minCrtvaiWei: quote.minCrtvaiWei.toString(),
  }
}

function fromStoredQuote(stored: StoredQuote): SeedanceBillingQuote {
  return {
    quoteId: stored.quoteId,
    duration: stored.duration,
    resolution: stored.resolution,
    estimatedUsdc6: stored.estimatedUsdc6,
    minCrtvaiWei: BigInt(stored.minCrtvaiWei),
  }
}

async function persistQuote(quote: SeedanceBillingQuote): Promise<void> {
  memoryQuotes.set(quote.quoteId, quote)
  if (!isRedisConfigured()) return

  const redis = await getRedis()
  if (!redis) return

  await redis.set(`${QUOTE_KEY_PREFIX}${quote.quoteId}`, JSON.stringify(toStoredQuote(quote)), {
    ex: QUOTE_TTL_SECONDS,
  })
}

async function loadQuote(quoteId: string): Promise<SeedanceBillingQuote | null> {
  const id = quoteId.trim()
  const cached = memoryQuotes.get(id)
  if (cached) return cached

  if (!isRedisConfigured()) return null

  const redis = await getRedis()
  if (!redis) return null

  const raw = await redis.get<string>(`${QUOTE_KEY_PREFIX}${id}`)
  if (typeof raw !== 'string') return null

  try {
    const stored = JSON.parse(raw) as StoredQuote
    const quote = fromStoredQuote(stored)
    memoryQuotes.set(id, quote)
    return quote
  } catch {
    return null
  }
}

async function persistReservation(reservation: SeedanceBillingReservation): Promise<void> {
  memoryReservations.set(reservation.reservationId, reservation)
  if (!isRedisConfigured()) return

  const redis = await getRedis()
  if (!redis) return

  const ttlSeconds = Math.max(60, Math.ceil((reservation.expiresAtMs - Date.now()) / 1000))
  await redis.set(`${RESERVATION_KEY_PREFIX}${reservation.reservationId}`, JSON.stringify(reservation), {
    ex: ttlSeconds,
  })
}

async function loadReservation(reservationId: string): Promise<SeedanceBillingReservation | null> {
  const id = reservationId.trim()
  const cached = memoryReservations.get(id)
  if (cached) return cached

  if (!isRedisConfigured()) return null

  const redis = await getRedis()
  if (!redis) return null

  const raw = await redis.get<string>(`${RESERVATION_KEY_PREFIX}${id}`)
  if (typeof raw !== 'string') return null

  try {
    const reservation = JSON.parse(raw) as SeedanceBillingReservation
    memoryReservations.set(id, reservation)
    return reservation
  } catch {
    return null
  }
}

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
  void persistQuote(quote)
  return quote
}

export async function reserveSeedanceSpend(
  quoteId: string,
  wallet: string,
): Promise<SeedanceBillingReservation | null> {
  const quote = await loadQuote(quoteId)
  if (!quote) return null

  const reservation: SeedanceBillingReservation = {
    reservationId: randomUUID(),
    quoteId: quote.quoteId,
    wallet: wallet.trim().toLowerCase(),
    expiresAtMs: Date.now() + QUOTE_TTL_SECONDS * 1000,
  }
  await persistReservation(reservation)
  return reservation
}

/** Mark a reservation settled after successful delivery. */
export async function settleSeedanceSpend(reservationId: string): Promise<void> {
  const reservation = await loadReservation(reservationId)
  if (!reservation || reservation.settled) return

  const settled: SeedanceBillingReservation = { ...reservation, settled: true }
  await persistReservation(settled)

  memoryQuotes.delete(reservation.quoteId)
  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      await redis.del(`${QUOTE_KEY_PREFIX}${reservation.quoteId}`)
    }
  }
}

export async function getSeedanceQuote(quoteId: string): Promise<SeedanceBillingQuote | null> {
  return loadQuote(quoteId)
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
