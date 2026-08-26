/**
 * One-time consumption of CRTVAI payment tx hashes (anti-replay).
 * Requires Upstash/Vercel KV when billing is enforced.
 */

import { getRedis, isRedisConfigured } from './_redis-client.js'

const PAYMENT_KEY_PREFIX = 'pixels:payment:tx:'
const PAYMENT_TTL_SECONDS = 60 * 60 * 24 * 14 // 14 days

export type ConsumePaymentResult = { ok: true } | { ok: false; reason: string }

/**
 * Mark `txHash` as spent. Fails if already consumed.
 * When Redis is not configured, returns ok only if billing soft/local — callers
 * that enforce billing should require Redis.
 */
export async function consumePaymentTxHash(
  txHash: string,
  meta: { wallet: string; purpose: string },
): Promise<ConsumePaymentResult> {
  const normalized = txHash.trim().toLowerCase()
  if (!normalized.startsWith('0x') || normalized.length < 66) {
    return { ok: false, reason: 'Invalid payment transaction hash' }
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

  const key = `${PAYMENT_KEY_PREFIX}${normalized}`
  // SET NX — only succeeds the first time
  const set = await redis.set(
    key,
    JSON.stringify({
      wallet: meta.wallet.toLowerCase(),
      purpose: meta.purpose,
      at: Date.now(),
    }),
    { nx: true, ex: PAYMENT_TTL_SECONDS },
  )

  if (set === null) {
    return { ok: false, reason: 'Payment transaction already used' }
  }

  return { ok: true }
}

/** Whether production billing can safely enforce one-time payments. */
export function isPaymentLedgerReady(): boolean {
  return isRedisConfigured()
}
