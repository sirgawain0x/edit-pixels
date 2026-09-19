/**
 * Redis-backed batch quote / confirm records for Director → Pixels bridge.
 */
// fallow-ignore-file complexity

import { randomUUID } from 'node:crypto'
import { getRedis, isRedisConfigured } from './_redis-client.js'
import type { PixelsRenderProvider } from './_director-generate-map.js'
import type { SeedanceResolution } from './_seedance-pricing.js'

const BATCH_QUOTE_PREFIX = 'pixels:director:batch-quote:'
const BATCH_CONFIRM_PREFIX = 'pixels:director:batch-confirm:'
const BATCH_QUOTE_CONSUMED_PREFIX = 'pixels:director:batch-quote-consumed:'
const BATCH_SHOT_CLAIM_PREFIX = 'pixels:director:batch-shot-claim:'
const BATCH_TTL_SECONDS = 15 * 60
const BATCH_CONFIRM_REFRESH_SECONDS = 60 * 60

export interface DirectorBatchShotQuoteRecord {
  shotId: string
  prompt: string
  duration: number
  veoDuration: number
  seedanceDuration: number
  aspect_ratio: string
  resolution: SeedanceResolution
  recommendedProvider: PixelsRenderProvider
  veoCrtvaiWei: string
  veoUsdc6: number
  seedanceQuoteId: string
  seedanceCrtvaiWei: string
  seedanceUsdc6: number
}

export interface DirectorBatchQuoteRecord {
  batchQuoteId: string
  wallet: string
  storyboardId: string | null
  providerPreference: PixelsRenderProvider | null
  shots: DirectorBatchShotQuoteRecord[]
  totals: {
    allVeoCrtvaiWei: string
    allSeedanceCrtvaiWei: string
    recommendedMixCrtvaiWei: string
  }
  createdAtMs: number
  expiresAtMs: number
}

export interface DirectorBatchConfirmShot {
  shotId: string
  provider: PixelsRenderProvider
  requestId: string
  started?: boolean
}

export interface DirectorBatchConfirmRecord {
  batchConfirmId: string
  batchQuoteId: string
  wallet: string
  paymentTxHash: string | null
  totalCrtvaiWei: string
  shots: DirectorBatchConfirmShot[]
  createdAtMs: number
  expiresAtMs: number
}

const memoryQuotes = new Map<string, DirectorBatchQuoteRecord>()
const memoryConfirms = new Map<string, DirectorBatchConfirmRecord>()
const memoryConsumedQuotes = new Set<string>()
const memoryShotClaims = new Set<string>()

function allowMemoryFallback(): boolean {
  return !process.env.VERCEL
}

function shotClaimKey(batchConfirmId: string, shotId: string): string {
  return `${BATCH_SHOT_CLAIM_PREFIX}${batchConfirmId.trim()}:${shotId.trim()}`
}

async function persistJson(key: string, value: unknown, ttlSeconds = BATCH_TTL_SECONDS): Promise<void> {
  if (!isRedisConfigured()) return
  const redis = await getRedis()
  if (!redis) return
  await redis.set(key, JSON.stringify(value), { ex: ttlSeconds })
}

async function loadJson<T>(key: string): Promise<T | null> {
  if (!isRedisConfigured()) return null
  const redis = await getRedis()
  if (!redis) return null
  const raw = await redis.get<string>(key)
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function isDirectorBatchQuoteConsumed(batchQuoteId: string): Promise<boolean> {
  const id = batchQuoteId.trim()
  if (!id) return false
  if (memoryConsumedQuotes.has(id)) return true
  if (!isRedisConfigured()) return false
  const redis = await getRedis()
  if (!redis) return false
  const consumed = await redis.get<string>(`${BATCH_QUOTE_CONSUMED_PREFIX}${id}`)
  return consumed !== null && consumed !== undefined
}

export async function consumeDirectorBatchQuote(
  batchQuoteId: string,
): Promise<{ ok: true } | { ok: false; error: 'quote_already_confirmed' }> {
  const id = batchQuoteId.trim()
  if (!id) return { ok: false, error: 'quote_already_confirmed' }

  if (memoryConsumedQuotes.has(id)) {
    return { ok: false, error: 'quote_already_confirmed' }
  }

  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      const key = `${BATCH_QUOTE_CONSUMED_PREFIX}${id}`
      const set = await redis.set(key, String(Date.now()), { nx: true, ex: BATCH_TTL_SECONDS })
      if (set === null) {
        memoryConsumedQuotes.add(id)
        return { ok: false, error: 'quote_already_confirmed' }
      }
      memoryConsumedQuotes.add(id)
      return { ok: true }
    }
  }

  if (!allowMemoryFallback()) {
    return { ok: false, error: 'quote_already_confirmed' }
  }

  memoryConsumedQuotes.add(id)
  return { ok: true }
}

export async function saveDirectorBatchQuote(
  record: Omit<DirectorBatchQuoteRecord, 'batchQuoteId' | 'createdAtMs' | 'expiresAtMs'> & {
    batchQuoteId?: string
  },
): Promise<DirectorBatchQuoteRecord> {
  const batchQuoteId = record.batchQuoteId?.trim() || randomUUID()
  const createdAtMs = Date.now()
  const full: DirectorBatchQuoteRecord = {
    ...record,
    batchQuoteId,
    createdAtMs,
    expiresAtMs: createdAtMs + BATCH_TTL_SECONDS * 1000,
  }

  memoryQuotes.set(batchQuoteId, full)
  await persistJson(`${BATCH_QUOTE_PREFIX}${batchQuoteId}`, full)
  return full
}

export async function getDirectorBatchQuote(
  batchQuoteId: string,
): Promise<DirectorBatchQuoteRecord | null> {
  const id = batchQuoteId.trim()
  if (!id) return null
  if (await isDirectorBatchQuoteConsumed(id)) return null

  const cached = memoryQuotes.get(id)
  if (cached) {
    if (cached.expiresAtMs < Date.now()) {
      memoryQuotes.delete(id)
      return null
    }
    return cached
  }

  const loaded = await loadJson<DirectorBatchQuoteRecord>(`${BATCH_QUOTE_PREFIX}${id}`)
  if (!loaded) {
    if (!allowMemoryFallback()) return null
    return null
  }
  if (loaded.expiresAtMs < Date.now()) return null
  memoryQuotes.set(id, loaded)
  return loaded
}

export async function saveDirectorBatchConfirm(
  record: Omit<DirectorBatchConfirmRecord, 'batchConfirmId' | 'createdAtMs' | 'expiresAtMs'> & {
    batchConfirmId?: string
  },
): Promise<DirectorBatchConfirmRecord> {
  const batchConfirmId = record.batchConfirmId?.trim() || randomUUID()
  const createdAtMs = Date.now()
  const full: DirectorBatchConfirmRecord = {
    ...record,
    batchConfirmId,
    createdAtMs,
    expiresAtMs: createdAtMs + BATCH_TTL_SECONDS * 1000,
  }

  memoryConfirms.set(batchConfirmId, full)
  await persistJson(`${BATCH_CONFIRM_PREFIX}${batchConfirmId}`, full)
  return full
}

export async function getDirectorBatchConfirm(
  batchConfirmId: string,
): Promise<DirectorBatchConfirmRecord | null> {
  const id = batchConfirmId.trim()
  if (!id) return null

  const cached = memoryConfirms.get(id)
  if (cached) {
    if (cached.expiresAtMs < Date.now()) {
      memoryConfirms.delete(id)
      return null
    }
    return cached
  }

  const loaded = await loadJson<DirectorBatchConfirmRecord>(`${BATCH_CONFIRM_PREFIX}${id}`)
  if (!loaded) {
    if (!allowMemoryFallback()) return null
    return null
  }
  if (loaded.expiresAtMs < Date.now()) return null
  memoryConfirms.set(id, loaded)
  return loaded
}

/** Extend confirm TTL when a per-shot generate claim succeeds (P2). */
export async function refreshDirectorBatchConfirmTtl(batchConfirmId: string): Promise<void> {
  const confirm = await getDirectorBatchConfirm(batchConfirmId)
  if (!confirm) return

  const refreshed: DirectorBatchConfirmRecord = {
    ...confirm,
    expiresAtMs: Date.now() + BATCH_CONFIRM_REFRESH_SECONDS * 1000,
  }
  memoryConfirms.set(confirm.batchConfirmId, refreshed)
  await persistJson(
    `${BATCH_CONFIRM_PREFIX}${confirm.batchConfirmId}`,
    refreshed,
    BATCH_CONFIRM_REFRESH_SECONDS,
  )
}

/**
 * Atomic per-shot claim (SETNX). Claim is taken only after pre-flight passes;
 * release on provider failure so the user can retry.
 */
export async function tryClaimDirectorBatchShot(input: {
  batchConfirmId: string
  shotId: string
  requestId: string
}): Promise<{ ok: true } | { ok: false; error: 'batch_shot_already_started' }> {
  const key = shotClaimKey(input.batchConfirmId, input.shotId)
  const payload = JSON.stringify({
    requestId: input.requestId.trim(),
    at: Date.now(),
  })

  if (memoryShotClaims.has(key)) {
    return { ok: false, error: 'batch_shot_already_started' }
  }

  if (isRedisConfigured()) {
    const redis = await getRedis()
    if (redis) {
      const set = await redis.set(key, payload, { nx: true, ex: BATCH_CONFIRM_REFRESH_SECONDS })
      if (set === null) {
        return { ok: false, error: 'batch_shot_already_started' }
      }
      memoryShotClaims.add(key)
      return { ok: true }
    }
  }

  if (!allowMemoryFallback()) {
    return { ok: false, error: 'batch_shot_already_started' }
  }

  memoryShotClaims.add(key)
  return { ok: true }
}

export async function releaseDirectorBatchShotClaim(
  batchConfirmId: string,
  shotId: string,
): Promise<void> {
  const key = shotClaimKey(batchConfirmId, shotId)
  memoryShotClaims.delete(key)
  if (!isRedisConfigured()) return
  const redis = await getRedis()
  if (!redis) return
  await redis.del(key)
}

export async function markDirectorBatchShotStarted(
  batchConfirmId: string,
  shotId: string,
): Promise<DirectorBatchConfirmRecord | null> {
  const confirm = await getDirectorBatchConfirm(batchConfirmId)
  if (!confirm) return null

  const trimmedShotId = shotId.trim()
  const nextShots = confirm.shots.map((shot) =>
    shot.shotId === trimmedShotId ? { ...shot, started: true } : shot,
  )

  const next: DirectorBatchConfirmRecord = {
    ...confirm,
    shots: nextShots,
  }

  memoryConfirms.set(confirm.batchConfirmId, next)
  await persistJson(`${BATCH_CONFIRM_PREFIX}${confirm.batchConfirmId}`, next, BATCH_CONFIRM_REFRESH_SECONDS)
  return next
}

export function findBatchConfirmShot(
  confirm: DirectorBatchConfirmRecord,
  shotId: string,
  requestId: string,
): DirectorBatchConfirmShot | null {
  const sid = shotId.trim()
  const rid = requestId.trim()
  return (
    confirm.shots.find((shot) => shot.shotId === sid && shot.requestId === rid) ?? null
  )
}

/** Test-only reset. */
export function __resetDirectorBatchStoreForTest(): void {
  memoryQuotes.clear()
  memoryConfirms.clear()
  memoryConsumedQuotes.clear()
  memoryShotClaims.clear()
}
