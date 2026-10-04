/// <reference types="node" />
/**
 * Firestore persistence for Creative Director sessions, storyboards, and billing audit.
 * Agent Engine remains the source of truth for conversation memory.
 *
 * Uses Firestore REST (not `@google-cloud/firestore`) so SDK/gRPC init cannot
 * crash `POST /api/director`.
 */
// fallow-ignore-file complexity

import type { DirectorBillingQuote } from './director-billing.js'
import {
  createFirestoreDocument,
  encodeFirestoreInteger,
  encodeFirestoreNull,
  encodeFirestoreNumber,
  encodeFirestoreString,
  encodeFirestoreStringArray,
  encodeFirestoreTimestamp,
  FIRESTORE_REST_TIMEOUT_MS,
  isDirectorFirestoreEnabled,
  patchFirestoreDocument,
  readFirestoreString,
  readFirestoreTimestamp,
  documentIdFromName,
  runFirestoreStructuredQuery,
} from './_firestore-rest.js'
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

function stringOrNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? encodeFirestoreString(trimmed) : encodeFirestoreNull()
}

export async function persistDirectorPayment(input: {
  txHash: string
  walletAddress: string
  quote: DirectorBillingQuote
  audioDurationSeconds: number
  sessionId?: string
  projectId?: string
}): Promise<void> {
  if (!isDirectorFirestoreEnabled()) return

  const wallet = normalizeWallet(input.walletAddress)
  const txHash = input.txHash.trim().toLowerCase()
  if (!wallet || !txHash.startsWith('0x')) return

  await patchFirestoreDocument({
    collection: PAYMENTS,
    documentId: txHash,
    fields: {
      wallet: encodeFirestoreString(wallet),
      quoteUsdc6: encodeFirestoreInteger(input.quote.estimatedUsdc6),
      billableMinutes: encodeFirestoreNumber(input.quote.billableMinutes),
      tier: encodeFirestoreString(input.quote.tier),
      audioSeconds: encodeFirestoreNumber(input.audioDurationSeconds),
      sessionId: stringOrNull(input.sessionId),
      projectId: stringOrNull(input.projectId),
      createdAt: encodeFirestoreTimestamp(),
    },
  })
}

export async function persistDirectorPaymentWhenQuoted(input: {
  paymentTxHash: string | null
  quote: DirectorBillingQuote | null
  audioSeconds: number | null
  walletAddress?: string
  sessionId?: string
  projectId?: string
}): Promise<void> {
  if (!input.paymentTxHash || !input.quote || input.audioSeconds == null || !input.walletAddress) {
    return
  }
  await persistDirectorPayment({
    txHash: input.paymentTxHash,
    walletAddress: input.walletAddress,
    quote: input.quote,
    audioDurationSeconds: input.audioSeconds,
    sessionId: input.sessionId,
    projectId: input.projectId,
  }).catch((error) => {
    console.error('Director Firestore payment persist failed', error)
  })
}

export async function upsertDirectorSession(
  ctx: DirectorPersistContext,
  status: DirectorSessionStatus,
  sessionId?: string | null,
): Promise<void> {
  if (!isDirectorFirestoreEnabled()) return

  const wallet = normalizeWallet(ctx.walletAddress)
  const resolvedSessionId = sessionDocId(sessionId ?? ctx.initialSessionId, ctx.userId)
  const stamped = encodeFirestoreTimestamp()

  const fields: Parameters<typeof patchFirestoreDocument>[0]['fields'] = {
    userId: encodeFirestoreString(ctx.userId),
    wallet: wallet ? encodeFirestoreString(wallet) : encodeFirestoreNull(),
    projectId: stringOrNull(ctx.projectId),
    engineId: encodeFirestoreString(ctx.engineId),
    audioUri: stringOrNull(ctx.audioUri),
    promptPreview: encodeFirestoreString(ctx.promptPreview.slice(0, 240)),
    status: encodeFirestoreString(status),
    updatedAt: stamped,
  }
  if (status === 'streaming') {
    fields.createdAt = stamped
  }

  await patchFirestoreDocument({
    collection: SESSIONS,
    documentId: resolvedSessionId,
    fields,
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
  if (!isDirectorFirestoreEnabled()) return

  await createFirestoreDocument({
    collection: STORYBOARDS,
    fields: {
      sessionId: encodeFirestoreString(resolvedSessionId),
      projectId: stringOrNull(ctx.projectId),
      wallet: (() => {
        const wallet = normalizeWallet(ctx.walletAddress)
        return wallet ? encodeFirestoreString(wallet) : encodeFirestoreNull()
      })(),
      userId: encodeFirestoreString(ctx.userId),
      markdown: encodeFirestoreString(markdown),
      scenes: encodeFirestoreStringArray(extractStoryboardScenes(markdown)),
      createdAt: encodeFirestoreTimestamp(),
    },
  })
}

export async function listDirectorSessions(input: {
  walletAddress: string
  projectId?: string
  limit?: number
}): Promise<DirectorSessionListItem[]> {
  const wallet = normalizeWallet(input.walletAddress)
  if (!wallet) return []
  if (!isDirectorFirestoreEnabled()) return []

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
  const projectId = input.projectId?.trim()

  try {
    const documents = await runFirestoreStructuredQuery({
      timeoutMs: FIRESTORE_REST_TIMEOUT_MS,
      structuredQuery: {
        from: [{ collectionId: SESSIONS }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'wallet' },
            op: 'EQUAL',
            value: { stringValue: wallet },
          },
        },
        orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'DESCENDING' }],
        limit,
      },
    })

    return documents
      .map((doc) => {
        const fields = doc.fields ?? {}
        return {
          sessionId: documentIdFromName(doc.name),
          projectId: readFirestoreString(fields.projectId),
          promptPreview: readFirestoreString(fields.promptPreview) ?? '',
          status: (readFirestoreString(fields.status) as DirectorSessionStatus) ?? 'completed',
          audioUri: readFirestoreString(fields.audioUri),
          createdAt: readFirestoreTimestamp(fields.createdAt),
          updatedAt: readFirestoreTimestamp(fields.updatedAt),
        }
      })
      .filter((row) => row.sessionId && (!projectId || row.projectId === projectId))
  } catch (error) {
    console.error('Director Firestore list failed', error)
    return []
  }
}
