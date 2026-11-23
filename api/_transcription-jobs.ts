/// <reference types="node" />
/**
 * Firestore record for a cloud ("precision") transcription job.
 *
 * Why this lives under `api/`: Vercel serverless cannot load `../src/*.ts` at
 * runtime, and `scripts/check-api-src-imports.mjs` enforces that (see
 * `api/_transcription-pricing.ts` for the same pattern with pricing literals).
 * The product contract is `src/features/media-library/transcription/jobs/types.ts`;
 * this file only mirrors the subset the quote and poll routes touch.
 *
 * The record is the longest-lived artifact of a paid run: Google LROs expire in
 * days and the Redis payment key expires in 14, but this document is what
 * reconciliation, margin audits, and refund justification read months later.
 */
// fallow-ignore-file complexity

import {
  encodeFirestoreInteger,
  encodeFirestoreNull,
  encodeFirestoreNumber,
  encodeFirestoreString,
  encodeFirestoreTimestamp,
  FIRESTORE_REST_TIMEOUT_MS,
  getFirestoreDocument,
  patchFirestoreDocument,
  readFirestoreInteger,
  readFirestoreString,
  runFirestoreStructuredQuery,
  type FirestoreRestValue,
} from './_firestore-rest.js'
import { CHIRP3_BATCH_USDC6_PER_SEC } from './_transcription-pricing.js'

const COLLECTION = 'transcription_jobs'

/** Hard stop once COGS passes this fraction of the quote (mirrors the headless accumulator). */
const ABORT_RATIO = 0.8

/** Observed p95 operation round time; a retry that cannot finish in time must be refused. */
const MAX_OPERATION_ROUND_MS = 125_000

/** Buffer added to `maxOperationRoundMs` before comparing against `settleByMs`. */
const SETTLE_BUFFER_MS = 30_000

export type TranscriptionJobStatus =
  | 'quoted'
  | 'paid'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'failed'

export type TranscriptionReconcileVerdict =
  | 'exact'
  | 'missing-billing'
  | 'integrity-mismatch'
  | 'failed-parts'
  | 'plan-error'
  | 'drift'
  | 'submit-failure'

const JOB_STATUSES: readonly TranscriptionJobStatus[] = [
  'quoted',
  'paid',
  'running',
  'retrying',
  'completed',
  'failed',
]

const RECONCILE_VERDICTS: readonly TranscriptionReconcileVerdict[] = [
  'exact',
  'missing-billing',
  'integrity-mismatch',
  'failed-parts',
  'plan-error',
  'drift',
  'submit-failure',
]

/** Input to `POST /api/transcribe-precision`. */
export interface StartTranscriptionPrecisionRequest {
  mediaId: string
  model: string
  glossary?: string
  sourceDurationSec: number
  plan: Array<{
    startSec: number
    endSec: number
    overlapSec: number
    forcedCut: boolean
    vadSpeechSeconds: number
  }>
}

/** Output from `POST /api/transcribe-precision`. */
export interface StartTranscriptionPrecisionResponse {
  jobId: string
  quote?: {
    quoteId: string
    estimatedUsdc6: number
    minCrtvaiWei: string
    expiresAtMs: number
  }
  /** True when the price is zero and no quote/signature is needed. */
  free: boolean
}

/** Output from `GET /api/transcribe-job?jobId=...`. */
export interface TranscriptionBatchFileView {
  inputUri: string
  /** `gs://` result object; the client fetches it through our own proxy. */
  outputUri: string | null
  billedSeconds: number | null
  errorMessage: string | null
}

export interface GetTranscriptionJobResponse {
  jobId: string
  status: TranscriptionJobStatus
  reconcileVerdict: TranscriptionReconcileVerdict | null
  /** Live progress from the Google operation, only while the job is running. */
  progressPercent?: number
  /** Per-file results once the operation finished. */
  files?: TranscriptionBatchFileView[]
  totalBilledSeconds?: number | null
  errorMessage?: string
}

/** What a poll needs from the stored record; nothing else is read on the hot path. */
export interface TranscriptionJobSummary {
  accountId: string
  status: TranscriptionJobStatus
  reconcileVerdict: TranscriptionReconcileVerdict | null
  quoteId: string | null
  /** Minimum CRTVAI the quote demanded; the payment is verified against it. */
  minCrtvaiWei: string | null
  estimatedUsdc6: number | null
  submittedSecondsCeil: number | null
  /** Google operation name, pinned at submit; null until the batch is submitted. */
  operationName: string | null
  txHash: string | null
  /** Set only while this run holds a free-run credit; null once refunded or priced. */
  freeRunMonth: string | null
}

/**
 * UTC calendar month, e.g. `2026-11`, used as the free-run bucket key.
 *
 * UTC (not local time) so the bucket boundary cannot move with the user's
 * timezone or the server's TZ env — two servers must agree on the same month.
 */
export function transcriptionMonthKey(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 7)
}

function encodeFirestoreMap(fields: Record<string, FirestoreRestValue>): FirestoreRestValue {
  return { mapValue: { fields } }
}

/**
 * How many free short runs this account already started this UTC month.
 *
 * Counted from the job records themselves rather than a separate counter doc:
 * one source of truth, no rollover job, and no read-modify-write race that can
 * hand out a sixth free run to a double-click. Two equality filters ride
 * Firestore's automatic single-field indexes, so this needs no composite index.
 *
 * A record is a free run iff `freeRunMonth` equals the month being counted; the
 * field is written only when the run was actually granted at zero price.
 *
 * Returns `cap` as soon as the cap is reached — callers only compare against it.
 */
export async function countFreeRunsThisMonth(input: {
  accountId: string
  monthKey: string
  cap: number
}): Promise<number> {
  const cap = Math.max(1, Math.floor(input.cap))
  const documents = await runFirestoreStructuredQuery({
    timeoutMs: FIRESTORE_REST_TIMEOUT_MS,
    structuredQuery: {
      from: [{ collectionId: COLLECTION }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'accountId' },
                op: 'EQUAL',
                value: { stringValue: input.accountId },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'freeRunMonth' },
                op: 'EQUAL',
                value: { stringValue: input.monthKey },
              },
            },
          ],
        },
      },
      limit: cap,
    },
  })
  return documents.length
}

/** Everything the record pins at quote time; the submit path fills in the rest. */
export interface QuotedJobInput {
  jobId: string
  accountId: string
  mediaId: string
  estimatedUsdc6: number
  submittedSecondsCeil: number
  plannedParts: number
  quoteCreatedAtMs: number
  settleByMs: number
  /** Set only when this run was granted free; null for priced runs. */
  freeRunMonth: string | null
}

/** The settlement clock, nested so a reader cannot mistake it for a top-level field. */
function retryClockFields(input: QuotedJobInput): FirestoreRestValue {
  return encodeFirestoreMap({
    quoteCreatedAtMs: encodeFirestoreInteger(input.quoteCreatedAtMs),
    settleByMs: encodeFirestoreInteger(input.settleByMs),
    maxOperationRoundMs: encodeFirestoreInteger(MAX_OPERATION_ROUND_MS),
    settleBufferMs: encodeFirestoreInteger(SETTLE_BUFFER_MS),
  })
}

function quotedJobFields(input: QuotedJobInput): Record<string, FirestoreRestValue> {
  const abortLimitUsdc6 = Math.round(input.estimatedUsdc6 * ABORT_RATIO)
  return {
    // ── Identity ──
    jobId: encodeFirestoreString(input.jobId),
    accountId: encodeFirestoreString(input.accountId),
    mediaId: encodeFirestoreString(input.mediaId),

    // ── Pinned pricing ──
    estimatedUsdc6: encodeFirestoreInteger(input.estimatedUsdc6),
    rateUsdc6PerSec: encodeFirestoreInteger(CHIRP3_BATCH_USDC6_PER_SEC),
    submittedSecondsCeil: encodeFirestoreInteger(input.submittedSecondsCeil),
    abortRatio: encodeFirestoreNumber(ABORT_RATIO),
    abortLimitUsdc6: encodeFirestoreInteger(abortLimitUsdc6),
    // Same line as the abort limit today; split here if product wants a
    // separate margin alert before the hard stop.
    alertAtUsdc6: encodeFirestoreInteger(abortLimitUsdc6),
    plannedParts: encodeFirestoreInteger(input.plannedParts),
    freeRunMonth: input.freeRunMonth
      ? encodeFirestoreString(input.freeRunMonth)
      : encodeFirestoreNull(),

    // ── Settlement clock ──
    pinnedAt: encodeFirestoreInteger(input.quoteCreatedAtMs),
    quoteCreatedAtMs: encodeFirestoreInteger(input.quoteCreatedAtMs),
    settleByMs: encodeFirestoreInteger(input.settleByMs),
    retryClock: retryClockFields(input),

    // ── Retry budget, untouched until the submit path starts spending ──
    retrySpendUsdc6: encodeFirestoreInteger(0),
    retryingAt: encodeFirestoreNull(),
    retryingPartIndex: encodeFirestoreNull(),

    // ── Status ──
    status: encodeFirestoreString('quoted'),
    reconcileVerdict: encodeFirestoreNull(),
    releasedAt: encodeFirestoreNull(),
    createdAt: encodeFirestoreInteger(input.quoteCreatedAtMs),
    completedAt: encodeFirestoreNull(),
  }
}

/**
 * Write the job record *before* any payment, pinning every number a later
 * reconcile has to trust: the cost rate, the ceil'd submitted seconds, the
 * abort/alert lines, and the settlement clock.
 *
 * Pinning matters because thresholds and rates get retuned. A historical job
 * must still be readable with the constants that were true when it ran, or the
 * margin audit silently re-scores old jobs against new rules.
 *
 * Returns false when the write failed (Firestore disabled or unreachable).
 * Callers must treat that as "no durable ledger entry exists" — a free run in
 * particular is only safe to grant when its record actually landed.
 */
export async function createQuotedTranscriptionJob(input: QuotedJobInput): Promise<boolean> {
  return patchFirestoreDocument({
    collection: COLLECTION,
    documentId: input.jobId,
    timeoutMs: FIRESTORE_REST_TIMEOUT_MS,
    fields: quotedJobFields(input),
  })
}

/**
 * Pin the CRTVAI quote onto the record once it exists.
 *
 * Best effort: the payment ledger is the authority on whether the user paid, so
 * a failed patch must not fail the quote response. It only costs audit detail.
 */
export async function attachQuoteToTranscriptionJob(input: {
  jobId: string
  quoteId: string
  minCrtvaiWei: string
  expiresAtMs: number
}): Promise<boolean> {
  return patchFirestoreDocument({
    collection: COLLECTION,
    documentId: input.jobId,
    timeoutMs: FIRESTORE_REST_TIMEOUT_MS,
    fields: {
      quoteId: encodeFirestoreString(input.quoteId),
      minCrtvaiWei: encodeFirestoreString(input.minCrtvaiWei),
      quoteExpiresAtMs: encodeFirestoreInteger(input.expiresAtMs),
    },
  })
}

/** Mark a record failed so an abandoned quote cannot read as still in flight. */
export async function markTranscriptionJobFailed(jobId: string): Promise<boolean> {
  return patchFirestoreDocument({
    collection: COLLECTION,
    documentId: jobId,
    timeoutMs: FIRESTORE_REST_TIMEOUT_MS,
    fields: {
      status: encodeFirestoreString('failed'),
      updatedAt: encodeFirestoreTimestamp(),
    },
  })
}

/**
 * Pin the batch submission onto the record: the operation name is the only handle
 * to that job's progress and billing from here on, and the tx hash is what a later
 * reconciliation uses to prove the user paid for it.
 */
export async function recordBatchSubmission(input: {
  jobId: string
  operationName: string
  /** Null for a free run, which is paid for by its monthly allowance, not a tx. */
  txHash: string | null
  logIndex: number | null
  submittedAt: number
}): Promise<boolean> {
  return patchFirestoreDocument({
    collection: COLLECTION,
    documentId: input.jobId,
    timeoutMs: FIRESTORE_REST_TIMEOUT_MS,
    fields: {
      status: encodeFirestoreString('running'),
      operationName: encodeFirestoreString(input.operationName),
      txHash: input.txHash ? encodeFirestoreString(input.txHash) : encodeFirestoreNull(),
      logIndex:
        input.logIndex === null ? encodeFirestoreNull() : encodeFirestoreInteger(input.logIndex),
      submittedAt: encodeFirestoreInteger(input.submittedAt),
      updatedAt: encodeFirestoreTimestamp(),
    },
  })
}

/**
 * Give a free run back.
 *
 * The allowance is counted as "records in this month with `freeRunMonth` set", so
 * clearing it *is* the refund. `freeRunRefundedAt` keeps the audit trail: a record
 * showing both fields says a credit was granted and then returned, which a bare
 * null could not distinguish from a priced run.
 */
export async function refundFreeRun(jobId: string, atMs = Date.now()): Promise<boolean> {
  return patchFirestoreDocument({
    collection: COLLECTION,
    documentId: jobId,
    timeoutMs: FIRESTORE_REST_TIMEOUT_MS,
    fields: {
      freeRunMonth: encodeFirestoreNull(),
      freeRunRefundedAt: encodeFirestoreInteger(atMs),
      updatedAt: encodeFirestoreTimestamp(),
    },
  })
}

function asJobStatus(value: string | null): TranscriptionJobStatus | null {
  return value && (JOB_STATUSES as readonly string[]).includes(value)
    ? (value as TranscriptionJobStatus)
    : null
}

function asReconcileVerdict(value: string | null): TranscriptionReconcileVerdict | null {
  return value && (RECONCILE_VERDICTS as readonly string[]).includes(value)
    ? (value as TranscriptionReconcileVerdict)
    : null
}

/**
 * Read the stored job for polling. Never reconciles anything — a GET must not
 * mutate billing state, so unknown or half-written records read as `null`.
 */
export async function readTranscriptionJob(jobId: string): Promise<TranscriptionJobSummary | null> {
  const document = await getFirestoreDocument({
    collection: COLLECTION,
    documentId: jobId,
    timeoutMs: FIRESTORE_REST_TIMEOUT_MS,
  })
  const fields = document?.fields ?? {}
  const accountId = readFirestoreString(fields.accountId)
  const status = asJobStatus(readFirestoreString(fields.status))
  if (!accountId || !status) return null
  return {
    accountId,
    status,
    reconcileVerdict: asReconcileVerdict(readFirestoreString(fields.reconcileVerdict)),
    quoteId: readFirestoreString(fields.quoteId),
    minCrtvaiWei: readFirestoreString(fields.minCrtvaiWei),
    estimatedUsdc6: readFirestoreInteger(fields.estimatedUsdc6),
    submittedSecondsCeil: readFirestoreInteger(fields.submittedSecondsCeil),
    operationName: readFirestoreString(fields.operationName),
    txHash: readFirestoreString(fields.txHash),
    freeRunMonth: readFirestoreString(fields.freeRunMonth),
  }
}
