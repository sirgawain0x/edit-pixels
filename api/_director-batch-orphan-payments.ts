/**
 * Audit-only capture for CRTVAI payments that landed on-chain but could not be
 * matched to a batch quote server-side (quote expired or was deleted before
 * `/api/pixels-director-batch-confirm` verified/consumed the tx).
 *
 * This is intentionally not anti-replay consumption — the tx remains usable for
 * a refreshed quote via the client reuse flow. The record exists so ops can see
 * the payment and reconcile it against on-chain transfers.
 */
// fallow-ignore-file complexity

import {
  createFirestoreDocument,
  encodeFirestoreString,
  encodeFirestoreTimestamp,
  isDirectorFirestoreEnabled,
} from './_firestore-rest.js'
import { getRedis, isRedisConfigured } from './_redis-client.js'

const ORPHAN_PAYMENTS_COLLECTION = 'director_batch_orphan_payments'
const ORPHAN_PAYMENT_REDIS_PREFIX = 'pixels:director:batch:orphan-payment:'
const ORPHAN_PAYMENT_TTL_SECONDS = 60 * 60 * 24 * 14 // 14 days

export interface OrphanBatchPaymentRecord {
  wallet: string
  txHash: string
  purpose: string
  receivedAtMs: number
  batchQuoteId?: string
  error: string
}

function normalizeTxHash(txHash: string): string | null {
  const normalized = txHash.trim().toLowerCase()
  if (!normalized.startsWith('0x') || normalized.length < 66) return null
  return normalized
}

/**
 * Best-effort audit write. Never throws; failures are logged and swallowed so
 * the confirm error can still be returned to the caller immediately.
 */
export async function recordOrphanBatchPayment(record: OrphanBatchPaymentRecord): Promise<void> {
  const normalizedHash = normalizeTxHash(record.txHash)
  if (!normalizedHash) {
    console.warn('Skipping orphan payment audit for invalid tx hash', record.txHash)
    return
  }

  const normalizedWallet = record.wallet.trim().toLowerCase()
  if (!normalizedWallet.startsWith('0x') || normalizedWallet.length < 42) {
    console.warn('Skipping orphan payment audit for invalid wallet', record.wallet)
    return
  }

  try {
    await Promise.all([
      recordOrphanBatchPaymentInFirestore(record, normalizedHash, normalizedWallet),
      recordOrphanBatchPaymentInRedis(record, normalizedHash),
    ])
  } catch (error) {
    console.error('Orphan batch payment audit failed', error)
  }
}

async function recordOrphanBatchPaymentInFirestore(
  record: OrphanBatchPaymentRecord,
  normalizedHash: string,
  normalizedWallet: string,
): Promise<void> {
  if (!isDirectorFirestoreEnabled()) return

  await createFirestoreDocument({
    collection: ORPHAN_PAYMENTS_COLLECTION,
    fields: {
      wallet: encodeFirestoreString(normalizedWallet),
      txHash: encodeFirestoreString(normalizedHash),
      purpose: encodeFirestoreString(record.purpose),
      receivedAt: encodeFirestoreTimestamp(new Date(record.receivedAtMs).toISOString()),
      batchQuoteId: record.batchQuoteId
        ? encodeFirestoreString(record.batchQuoteId.trim())
        : { nullValue: null },
      error: encodeFirestoreString(record.error),
    },
  })
}

async function recordOrphanBatchPaymentInRedis(
  record: OrphanBatchPaymentRecord,
  normalizedHash: string,
): Promise<void> {
  if (!isRedisConfigured()) return
  const redis = await getRedis()
  if (!redis) return

  await redis.set(
    `${ORPHAN_PAYMENT_REDIS_PREFIX}${normalizedHash}`,
    JSON.stringify({
      wallet: record.wallet.trim().toLowerCase(),
      txHash: normalizedHash,
      purpose: record.purpose,
      receivedAtMs: record.receivedAtMs,
      batchQuoteId: record.batchQuoteId?.trim() ?? null,
      error: record.error,
    }),
    { ex: ORPHAN_PAYMENT_TTL_SECONDS },
  )
}
