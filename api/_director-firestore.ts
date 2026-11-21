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
  deleteFirestoreDocument,
  encodeFirestoreInteger,
  encodeFirestoreNull,
  encodeFirestoreNumber,
  encodeFirestoreString,
  encodeFirestoreStringArray,
  encodeFirestoreTimestamp,
  FIRESTORE_REST_TIMEOUT_MS,
  getFirestoreDocument,
  isDirectorFirestoreEnabled,
  patchFirestoreDocument,
  readFirestoreInteger,
  readFirestoreString,
  readFirestoreTimestamp,
  documentIdFromName,
  runFirestoreStructuredQuery,
} from './_firestore-rest.js'
import { extractStoryboardScenes, type DirectorSsePersistState } from './_director-sse-persist.js'
import { rethrowIfServiceAccountImpersonationDenied } from './_vertex-auth.js'

const SESSIONS = 'director_sessions'
const STORYBOARDS = 'director_storyboards'
const PAYMENTS = 'director_payments'
const TURNS = 'director_turns'
/** Per-turn content cap (Firestore doc limit is 1 MiB; storyboards are ~10–20 KB). */
const TURN_CONTENT_MAX_CHARS = 200_000

export type DirectorSessionStatus = 'streaming' | 'completed' | 'failed'

export interface DirectorPersistContext {
  userId: string
  walletAddress?: string
  projectId?: string
  audioUri?: string
  engineId: string
  initialSessionId?: string
  promptPreview: string
  /** What the user typed (no timeline-audio preamble) — stored as the user turn. */
  userText?: string
  /** First turn of a conversation — only then is `promptPreview` (the list title) written. */
  isNewSession?: boolean
}

export interface DirectorTranscriptMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface DirectorSessionTranscript {
  sessionId: string
  promptPreview: string
  status: DirectorSessionStatus
  projectId: string | null
  updatedAt: string
  messages: DirectorTranscriptMessage[]
  /** `turns` = full transcript; `storyboards` = legacy sessions (assistant replies only). */
  source: 'turns' | 'storyboards' | 'empty'
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

async function persistDirectorPayment(input: {
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
    status: encodeFirestoreString(status),
    updatedAt: stamped,
  }
  // Keep the first brief as the session title; follow-up turns must not overwrite it.
  if (ctx.isNewSession !== false) {
    fields.promptPreview = encodeFirestoreString(ctx.promptPreview.slice(0, 240))
  }
  if (status === 'streaming' && ctx.isNewSession !== false) {
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
  if (status !== 'completed' || !isDirectorFirestoreEnabled()) return

  await appendDirectorTurns(ctx, resolvedSessionId, markdown)
  if (markdown.length < 50) return

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
      .filter(
        (row) =>
          row.sessionId &&
          // `pending-*` docs are pre-session placeholders, not resumable conversations.
          !row.sessionId.startsWith('pending-') &&
          (!projectId || row.projectId === projectId),
      )
  } catch (error) {
    console.error('Director Firestore list failed', error)
    rethrowIfServiceAccountImpersonationDenied(error)
    return []
  }
}

async function appendDirectorTurns(
  ctx: DirectorPersistContext,
  sessionId: string,
  assistantText: string,
): Promise<void> {
  const wallet = normalizeWallet(ctx.walletAddress)
  if (!wallet || sessionId.startsWith('pending-')) return
  const userText = (ctx.userText ?? ctx.promptPreview).trim()
  const seq = Date.now()
  const turns: Array<{ role: 'user' | 'assistant'; content: string; seq: number }> = []
  if (userText) turns.push({ role: 'user', content: userText, seq })
  if (assistantText) turns.push({ role: 'assistant', content: assistantText, seq: seq + 1 })

  for (const turn of turns) {
    await createFirestoreDocument({
      collection: TURNS,
      fields: {
        sessionId: encodeFirestoreString(sessionId),
        wallet: encodeFirestoreString(wallet),
        role: encodeFirestoreString(turn.role),
        content: encodeFirestoreString(turn.content.slice(0, TURN_CONTENT_MAX_CHARS)),
        seq: encodeFirestoreInteger(turn.seq),
        createdAt: encodeFirestoreTimestamp(),
      },
    })
  }
}

/** Equality-only query (no composite index needed); callers sort in memory. */
async function queryBySessionAndWallet(collectionId: string, sessionId: string, wallet: string) {
  return runFirestoreStructuredQuery({
    timeoutMs: FIRESTORE_REST_TIMEOUT_MS,
    structuredQuery: {
      from: [{ collectionId }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'sessionId' },
                op: 'EQUAL',
                value: { stringValue: sessionId },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'wallet' },
                op: 'EQUAL',
                value: { stringValue: wallet },
              },
            },
          ],
        },
      },
      limit: 200,
    },
  })
}

type OwnedSession =
  | { ok: true; fields: NonNullable<Awaited<ReturnType<typeof getFirestoreDocument>>>['fields'] }
  | { ok: false; reason: 'not_found' }

async function loadOwnedSession(sessionId: string, wallet: string): Promise<OwnedSession> {
  const doc = await getFirestoreDocument({ collection: SESSIONS, documentId: sessionId })
  const fields = doc?.fields ?? {}
  // Treat other wallets' sessions as missing so ids cannot be probed.
  if (!doc || readFirestoreString(fields.wallet) !== wallet)
    return { ok: false, reason: 'not_found' }
  return { ok: true, fields }
}

export async function getDirectorSessionTranscript(input: {
  walletAddress: string
  sessionId: string
}): Promise<DirectorSessionTranscript | null> {
  const wallet = normalizeWallet(input.walletAddress)
  const sessionId = input.sessionId.trim()
  if (!wallet || !sessionId || !isDirectorFirestoreEnabled()) return null

  const owned = await loadOwnedSession(sessionId, wallet)
  if (!owned.ok) return null
  const fields = owned.fields ?? {}
  const promptPreview = readFirestoreString(fields.promptPreview) ?? ''
  const base = {
    sessionId,
    promptPreview,
    status: (readFirestoreString(fields.status) as DirectorSessionStatus) ?? 'completed',
    projectId: readFirestoreString(fields.projectId),
    updatedAt: readFirestoreTimestamp(fields.updatedAt),
  }

  const turnDocs = await queryBySessionAndWallet(TURNS, sessionId, wallet)
  if (turnDocs.length > 0) {
    const messages = turnDocs
      .map((doc) => {
        const f = doc.fields ?? {}
        const role = readFirestoreString(f.role)
        return {
          role: role === 'user' ? ('user' as const) : ('assistant' as const),
          content: readFirestoreString(f.content) ?? '',
          createdAt: readFirestoreTimestamp(f.createdAt),
          seq: readFirestoreInteger(f.seq) ?? 0,
        }
      })
      .filter((m) => m.content)
      .sort((a, b) => a.seq - b.seq)
      .map(({ seq: _seq, ...message }) => message)
    return { ...base, messages, source: 'turns' }
  }

  // Legacy sessions (before per-turn transcripts): replay saved assistant replies.
  const storyboardDocs = await queryBySessionAndWallet(STORYBOARDS, sessionId, wallet)
  const replies = storyboardDocs
    .map((doc) => {
      const f = doc.fields ?? {}
      return {
        role: 'assistant' as const,
        content: readFirestoreString(f.markdown) ?? '',
        createdAt: readFirestoreTimestamp(f.createdAt),
      }
    })
    .filter((m) => m.content)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  if (replies.length === 0) return { ...base, messages: [], source: 'empty' }
  const opener = promptPreview
    ? [{ role: 'user' as const, content: promptPreview, createdAt: replies[0]?.createdAt ?? '' }]
    : []
  return { ...base, messages: [...opener, ...replies], source: 'storyboards' }
}

/** Delete a session index row plus its transcript turns and storyboards. */
export async function deleteDirectorSession(input: {
  walletAddress: string
  sessionId: string
}): Promise<'deleted' | 'not_found' | 'failed'> {
  const wallet = normalizeWallet(input.walletAddress)
  const sessionId = input.sessionId.trim()
  if (!wallet || !sessionId || !isDirectorFirestoreEnabled()) return 'not_found'

  const owned = await loadOwnedSession(sessionId, wallet)
  if (!owned.ok) return 'not_found'

  const [turnDocs, storyboardDocs] = await Promise.all([
    queryBySessionAndWallet(TURNS, sessionId, wallet),
    queryBySessionAndWallet(STORYBOARDS, sessionId, wallet),
  ])
  const children = [
    ...turnDocs.map((doc) => ({ collection: TURNS, documentId: documentIdFromName(doc.name) })),
    ...storyboardDocs.map((doc) => ({
      collection: STORYBOARDS,
      documentId: documentIdFromName(doc.name),
    })),
  ].filter((child) => child.documentId)

  const childResults = await Promise.all(children.map((child) => deleteFirestoreDocument(child)))
  const sessionDeleted = await deleteFirestoreDocument({
    collection: SESSIONS,
    documentId: sessionId,
  })
  return sessionDeleted && childResults.every(Boolean) ? 'deleted' : 'failed'
}
