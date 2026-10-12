/**
 * One-time consumption of CRTVAI payment tx hashes (anti-replay).
 * Requires Upstash/Vercel KV when billing is enforced.
 */
// fallow-ignore-file complexity

import { getRedis, isRedisConfigured } from './_redis-client.js'

const PAYMENT_KEY_PREFIX = 'pixels:payment:tx:'
const PAYMENT_TX_INDEX_SUFFIX = ':idx'
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

function txIndexKey(txHash: string): string {
  return `${PAYMENT_KEY_PREFIX}${txHash}${PAYMENT_TX_INDEX_SUFFIX}`
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

  await redis.set(txIndexKey(normalized), String(logIndex), {
    ex: PAYMENT_TTL_SECONDS,
  })

  return { ok: true }
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
export async function releasePaymentTxHash(txHash: string): Promise<void> {
  const normalized = normalizeTxHash(txHash)
  if (!normalized) return
  if (!isRedisConfigured()) return

  const redis = await getRedis()
  if (!redis) return

  const indexRaw = await redis.get<string>(txIndexKey(normalized))
  if (indexRaw) {
    const logIndex = Number.parseInt(indexRaw, 10)
    if (Number.isInteger(logIndex) && logIndex >= 0) {
      await redis.del(logConsumptionKey(normalized, logIndex))
    }
    await redis.del(txIndexKey(normalized))
  } else {
    await redis.del(`${PAYMENT_KEY_PREFIX}${normalized}:0`)
  }
}

/** Whether production billing can safely enforce one-time payments. */
export function isPaymentLedgerReady(): boolean {
  return isRedisConfigured()
}
