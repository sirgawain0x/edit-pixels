/**
 * One-time consumption of CRTVAI payment tx hashes (anti-replay).
 * Requires Upstash/Vercel KV when billing is enforced.
 */
// fallow-ignore-file complexity

import { getRedis, isRedisConfigured } from './_redis-client.js'

const PAYMENT_KEY_PREFIX = 'pixels:payment:tx:'
const PAYMENT_TTL_SECONDS = 60 * 60 * 24 * 14 // 14 days

export type ConsumePaymentResult = { ok: true } | { ok: false; reason: string }

function normalizeTxHash(txHash: string): string | null {
  const normalized = txHash.trim().toLowerCase()
  if (!normalized.startsWith('0x') || normalized.length < 66) return null
  return normalized
}

function logConsumptionKey(txHash: string, logIndex: number): string {
  return `${PAYMENT_KEY_PREFIX}${txHash}:${logIndex}`
}

/** Prod-era ledger key (hash only, no log index). */
function legacyHashConsumptionKey(normalizedTxHash: string): string {
  return `${PAYMENT_KEY_PREFIX}${normalizedTxHash}`
}

/**
 * Mark a specific CRTVAI Transfer log as spent (`txHash` + `logIndex`).
 * Fails if already consumed.
 */
export async function consumePaymentTxLog(
  txHash: string,
  logIndex: number,
  meta: { wallet: string; purpose: string },
): Promise<ConsumePaymentResult> {
  const normalized = normalizeTxHash(txHash)
  if (!normalized) {
    return { ok: false, reason: 'Invalid payment transaction hash' }
  }
  if (!Number.isInteger(logIndex) || logIndex < 0) {
    return { ok: false, reason: 'Invalid payment log index' }
  }

  if (!isRedisConfigured()) {
    return {
      ok: false,
      reason: 'Payment ledger unavailable (configure Upstash/Vercel KV)',
    }
  }

  const redis = await getRedis()
  if (!redis) {
    return { ok: false, reason: 'Payment ledger unavailable' }
  }

  // Prod stored one key per tx hash (`pixels:payment:tx:{hash}`) until promote; reject
  // replays until those keys expire (PAYMENT_TTL_SECONDS). TODO: remove after 2026-10-26.
  const legacyKey = legacyHashConsumptionKey(normalized)
  const legacySpent = await redis.get(legacyKey)
  if (legacySpent !== null && legacySpent !== undefined) {
    return { ok: false, reason: 'Payment transaction already used' }
  }

  const key = logConsumptionKey(normalized, logIndex)
  const set = await redis.set(
    key,
    JSON.stringify({
      wallet: meta.wallet.toLowerCase(),
      purpose: meta.purpose,
      logIndex,
      at: Date.now(),
    }),
    { nx: true, ex: PAYMENT_TTL_SECONDS },
  )

  if (set === null) {
    return { ok: false, reason: 'Payment transaction already used' }
  }

  return { ok: true }
}

/**
 * Parse a JSON value that may arrive as text. Returns null rather than throwing: a corrupt
 * ledger entry must read as "not recorded", never as a crash mid-redemption.
 */
function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/**
 * Read what a consumed payment log was spent on, if anything. Used by flows that may re-issue
 * the same receipt for the same purchase rather than re-charging.
 */
export async function readPaymentTxLog(
  txHash: string,
  logIndex: number,
): Promise<{ wallet: string; purpose: string; logIndex: number } | null> {
  const normalized = normalizeTxHash(txHash)
  if (!normalized || !Number.isInteger(logIndex) || logIndex < 0) return null
  if (!isRedisConfigured()) return null

  const redis = await getRedis()
  if (!redis) return null

  const raw = await redis.get(logConsumptionKey(normalized, logIndex))
  // Upstash's client deserialises JSON values, so a record written with `JSON.stringify` comes
  // back as an object here — a string-only guard silently reads every spent log as unspent.
  const parsed = typeof raw === 'string' ? safeJson(raw) : raw
  if (!parsed || typeof parsed !== 'object') return null

  const record = parsed as { wallet?: unknown; purpose?: unknown; logIndex?: unknown }
  if (typeof record.wallet !== 'string' || typeof record.purpose !== 'string') return null
  return {
    wallet: record.wallet,
    purpose: record.purpose,
    logIndex: typeof record.logIndex === 'number' ? record.logIndex : logIndex,
  }
}

/**
 * Spend a payment log once — or re-issue it to the *same* payer for the *same* purpose.
 *
 * A plain `consumePaymentTxLog` is right when the thing being bought is consumed immediately
 * (a render, a batch). It is wrong for a purchase the buyer is expected to keep, such as a
 * watermark removal whose certificate lives in the browser: losing that certificate must not
 * mean paying twice, and the server can re-sign from the transfer it already verified. The
 * purpose carries the project id, so "same purpose" cannot be widened to a second project.
 */
export async function claimPaymentTxLogForPurpose(
  txHash: string,
  logIndex: number,
  meta: { wallet: string; purpose: string },
): Promise<ConsumePaymentResult> {
  const consumed = await consumePaymentTxLog(txHash, logIndex, meta)
  if (consumed.ok) return consumed
  if (consumed.reason !== 'Payment transaction already used') return consumed

  const existing = await readPaymentTxLog(txHash, logIndex)
  const sameClaim =
    existing !== null &&
    existing.wallet.toLowerCase() === meta.wallet.toLowerCase() &&
    existing.purpose === meta.purpose
  return sameClaim ? { ok: true } : consumed
}

/** @deprecated Prefer `consumePaymentTxLog` with the verified Transfer log index. */
export async function consumePaymentTxHash(
  txHash: string,
  meta: { wallet: string; purpose: string },
): Promise<ConsumePaymentResult> {
  return consumePaymentTxLog(txHash, 0, meta)
}

/**
 * Release a consumed payment log so a failed pre-delivery request can be retried.
 */
export async function releasePaymentTxLog(txHash: string, logIndex: number): Promise<void> {
  const normalized = normalizeTxHash(txHash)
  if (!normalized) return
  if (!Number.isInteger(logIndex) || logIndex < 0) return
  if (!isRedisConfigured()) return

  const redis = await getRedis()
  if (!redis) return

  await redis.del(logConsumptionKey(normalized, logIndex))
}

/** Whether production billing can safely enforce one-time payments. */
export function isPaymentLedgerReady(): boolean {
  return isRedisConfigured()
}
