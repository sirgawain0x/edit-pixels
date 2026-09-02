/// <reference types="node" />
/**
 * Firestore persistence for Creative Director sessions, storyboards, and billing audit.
 * Agent Engine remains the source of truth for conversation memory.
 */
// fallow-ignore-file complexity

import { FieldValue, type Firestore } from '@google-cloud/firestore'
import type { DirectorBillingQuote } from './director-billing.js'
import { getFirestoreDb, isDirectorFirestoreEnabled } from './_firestore-client.js'
import { extractStoryboardScenes, type DirectorSsePersistState } from './_director-sse-persist.js'

const SESSIONS = 'director_sessions'
const STORYBOARDS = 'director_storyboards'
const PAYMENTS = 'director_payments'

export type DirectorSessionStatus = 'streaming' | 'completed' | 'failed'

export interface DirectorPersistContext {
  userId: string
  walletAddress?: string
  projectId?: string
  audioUri?: string
  engineId: string
  initialSessionId?: string
  promptPreview: string
}

interface DirectorSessionRecord {
  sessionId: string
  userId: string
  wallet: string | null
  projectId: string | null
  engineId: string
  audioUri: string | null
  promptPreview: string
  status: DirectorSessionStatus
  createdAt: string
  updatedAt: string
}

export interface DirectorSessionListItem {
  sessionId: string
  projectId: string | null
  promptPreview: string
  status: DirectorSessionStatus
  audioUri: string | null
  createdAt: string
  updatedAt: string
}

function normalizeWallet(walletAddress: string | undefined): string | null {
  const wallet = walletAddress?.trim().toLowerCase()
  if (!wallet?.startsWith('0x')) return null
  return wallet
}

function sessionDocId(sessionId: string | null | undefined, fallbackSeed: string): string {
  const id = sessionId?.trim()
  if (id) return id
  return `pending-${fallbackSeed}`
}

async function withDb<T>(fn: (db: Firestore) => Promise<T>): Promise<T | null> {
  if (!isDirectorFirestoreEnabled()) return null
  const db = await getFirestoreDb()
  if (!db) return null
  try {
    return await fn(db)
  } catch (error) {
    console.error('Director Firestore write failed', error)
    return null
  }
}

export async function persistDirectorPayment(input: {
  txHash: string
  walletAddress: string
  quote: DirectorBillingQuote
  audioDurationSeconds: number
  sessionId?: string
  projectId?: string
}): Promise<void> {
  const wallet = normalizeWallet(input.walletAddress)
  const txHash = input.txHash.trim().toLowerCase()
  if (!wallet || !txHash.startsWith('0x')) return

  await withDb(async (db) => {
    await db
      .collection(PAYMENTS)
      .doc(txHash)
      .set(
        {
          wallet,
          quoteUsdc6: input.quote.estimatedUsdc6,
          billableMinutes: input.quote.billableMinutes,
          tier: input.quote.tier,
          audioSeconds: input.audioDurationSeconds,
          sessionId: input.sessionId?.trim() || null,
          projectId: input.projectId?.trim() || null,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
  })
}

export async function upsertDirectorSession(
  ctx: DirectorPersistContext,
  status: DirectorSessionStatus,
  sessionId?: string | null,
): Promise<void> {
  const wallet = normalizeWallet(ctx.walletAddress)
  const resolvedSessionId = sessionDocId(sessionId ?? ctx.initialSessionId, ctx.userId)
  const projectId = ctx.projectId?.trim() || null

  await withDb(async (db) => {
    const ref = db.collection(SESSIONS).doc(resolvedSessionId)
    await ref.set(
      {
        userId: ctx.userId,
        wallet,
        projectId,
        engineId: ctx.engineId,
        audioUri: ctx.audioUri?.trim() || null,
        promptPreview: ctx.promptPreview.slice(0, 240),
        status,
        updatedAt: FieldValue.serverTimestamp(),
        ...(status === 'streaming' ? { createdAt: FieldValue.serverTimestamp() } : {}),
      },
      { merge: true },
    )
  })
}

export async function finalizeDirectorSession(
  ctx: DirectorPersistContext,
  sseState: DirectorSsePersistState,
  status: DirectorSessionStatus,
): Promise<void> {
  const resolvedSessionId = sessionDocId(sseState.sessionId ?? ctx.initialSessionId, ctx.userId)
  await upsertDirectorSession(ctx, status, resolvedSessionId)

  const markdown = sseState.assistantText.trim()
  if (status !== 'completed' || markdown.length < 50) return

  const projectId = ctx.projectId?.trim() || null
  const wallet = normalizeWallet(ctx.walletAddress)

  await withDb(async (db) => {
    await db.collection(STORYBOARDS).add({
      sessionId: resolvedSessionId,
      projectId,
      wallet,
      userId: ctx.userId,
      markdown,
      scenes: extractStoryboardScenes(markdown),
      createdAt: FieldValue.serverTimestamp(),
    })
  })
}

export async function listDirectorSessions(input: {
  walletAddress: string
  projectId?: string
  limit?: number
}): Promise<DirectorSessionListItem[]> {
  const wallet = normalizeWallet(input.walletAddress)
  if (!wallet) return []

  const db = await getFirestoreDb()
  if (!db) return []

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
  let query = db
    .collection(SESSIONS)
    .where('wallet', '==', wallet)
    .orderBy('updatedAt', 'desc')
    .limit(limit)

  const projectId = input.projectId?.trim()
  try {
    const snap = await query.get()
    return snap.docs
      .map((doc) => {
        const data = doc.data()
        const createdAt = data.createdAt?.toDate?.()?.toISOString?.() ?? ''
        const updatedAt = data.updatedAt?.toDate?.()?.toISOString?.() ?? ''
        return {
          sessionId: doc.id,
          projectId: typeof data.projectId === 'string' ? data.projectId : null,
          promptPreview: typeof data.promptPreview === 'string' ? data.promptPreview : '',
          status: (data.status as DirectorSessionStatus) ?? 'completed',
          audioUri: typeof data.audioUri === 'string' ? data.audioUri : null,
          createdAt,
          updatedAt,
        }
      })
      .filter((row) => !projectId || row.projectId === projectId)
  } catch (error) {
    console.error('Director Firestore list failed', error)
    return []
  }
}
