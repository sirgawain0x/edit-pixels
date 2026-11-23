/**
 * Firestore document schema for `transcription_jobs/{jobId}`.
 *
 * These records are the longest-lived artifact of a paid transcription: Google LROs
 * expire after days and the Redis payment key expires after 14 days, but the job
 * document must survive for reconciliation, margin audits, and refund justification.
 *
 * Retention:
 * - Payment and execution fields: permanent, no TTL.
 * - No user text content is stored here; skipped override snapshots live in the
 *   workspace AI-output store and are deleted with the project.
 */

import type { MediaTranscriptModel } from '@/types/storage'

export type TranscriptionJobStatus =
  | 'quoted'
  | 'paid'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'failed'

export type TranscriptionPartVerdict =
  | 'absent'
  | 'failed'
  | 'failed-unbilled'
  | 'billed-under-estimate'
  | 'billed-over-estimate'
  | 'exact'

export type TranscriptionQualityVerdict =
  | 'healthy'
  | 'suspect'
  | 'truncated'
  | 'vad-uncertain'
  | 'not-evaluated'

export type TranscriptionQualityFlag = 'under-detected' | 'no-silence' | null

export type TranscriptionRetryState = 'none' | 'retrying' | 'delivered' | 'exhausted'

export type TranscriptionReconcileVerdict =
  | 'exact'
  | 'missing-billing'
  | 'integrity-mismatch'
  | 'failed-parts'
  | 'plan-error'
  | 'drift'
  | 'submit-failure'

/** One retry entry, persisted inside the part for audit. costUsdc6 is derived from the matching operation. */
export interface TranscriptionPartRetry {
  at: number
  reason: 'suspect' | 'truncated'
  flag: TranscriptionQualityFlag
  partSeconds: number
  operationIndex: number
}

export interface TranscriptionJobPart {
  index: number
  /** Absolute start in seconds within the source audio. */
  startSec: number
  /** Absolute end in seconds within the source audio. */
  endSec: number
  /** Overlap with the next part, in seconds, counted inside this part's span. */
  overlapSec: number
  /** Whether this cut was forced because no silence boundary existed before the 1199.5s clamp. */
  forcedCut: boolean
  /** Billed seconds as reported by Google for this part (latest operation). */
  billedSecondsMeasured: number | null
  /** Ceil'd seconds used for the quote, before measurement. */
  estimateSeconds: number
  verdict: TranscriptionPartVerdict

  // ── Quality gate (content, not money) ──
  /** Speech seconds detected by the planner's VAD for this part. */
  vadSpeechSeconds: number | null
  /** Tokens per VAD speech second; the core quality metric. */
  tokensPerSpeechSecond: number | null
  /** vadSpeechSeconds / partDurationSec; disambiguates VAD impossibility cases. */
  speechRatio: number | null
  qualityVerdict: TranscriptionQualityVerdict
  qualityFlag: TranscriptionQualityFlag
  /** If forcedCut suppressed the no-silence flag, record that here; null otherwise. */
  suppressedFlag: TranscriptionQualityFlag

  // ── Retry state machine ──
  retryState: TranscriptionRetryState
  retries: TranscriptionPartRetry[]
}

/** Retry gate constants, pinned at submit. */
export interface TranscriptionRetryPolicy {
  /** Maximum observed operation round time, in ms, used to refuse retries that cannot finish before settleByMs. */
  maxOperationRoundMs: number
  /** Buffer added to maxOperationRoundMs before comparing against settleByMs. */
  settleBufferMs: number
}

/** Pinned gate constants stored with every job so future threshold changes don't rewrite history. */
export interface TranscriptionGateConfig {
  denominator: 'vad-speech-seconds'
  thresholds: {
    healthyAt: number
    truncatedBelow: number
  }
  sampleFloorSeconds: number
}

/** Pinned constants for the retry clock wall. */
export interface TranscriptionRetryClock {
  quoteCreatedAtMs: number
  settleByMs: number
  maxOperationRoundMs: number
  settleBufferMs: number
}

/** One BatchRecognize operation against the job. A retry is a separate operation. */
export interface TranscriptionJobOperation {
  operationName: string
  kind: 'initial' | 'retry'
  /** Index of the part this operation retried; omitted for the initial batch. */
  partIndex?: number
  startedAt: number
  completedAt: number | null
  /** Billed seconds as reported by Google at the operation level. */
  measuredBilledSeconds: number | null
  /**
   * Reconciled parts for THIS operation only.
   * The sum identity `sum(parts.billedSecondsMeasured) === measuredBilledSeconds` holds here.
   */
  parts: TranscriptionJobOperationPart[]
}

/** Per-part reconciliation within a single operation. */
export interface TranscriptionJobOperationPart {
  index: number
  billedSecondsMeasured: number | null
  estimateSeconds: number | null
  verdict: TranscriptionPartVerdict
  errorMessage: string | null
  resultUri: string | null
}

export interface TranscriptionJob {
  // ── Identity ──
  jobId: string
  accountId: string
  mediaId: string
  /** Cache key of the transcript this job produced or refreshed. */
  transcriptCacheKey: string

  // ── Payment (permanent) ──
  quoteId: string
  estimatedUsdc6: number
  minCrtvaiWei: string
  txHash: string
  logIndex: number
  /**
   * UTC month (`YYYY-MM`) this run was granted free in, or null when it was
   * priced. Written at quote time; this is the free-run ledger, so a record
   * without it does not count against the monthly allowance.
   */
  freeRunMonth: string | null
  /**
   * When a granted free run was given back, e.g. because the batch failed. A record
   * with both this and `freeRunMonth` never had its credit spent.
   */
  freeRunRefundedAt: number | null

  // ── Execution (permanent) ──
  /** Rate pinned at submit time; used to compute cogsUsdc6 from measured seconds. */
  rateUsdc6PerSec: number
  pinnedAt: number
  submittedSecondsCeil: number
  /** Quote creation time in ms; combined with settleByMs to enforce the CRTVAI settlement clock wall. */
  quoteCreatedAtMs: number
  /** Absolute deadline by which a retry must be started. Pinned at submit. */
  settleByMs: number
  /** When the batch was actually handed to Google; null while still quoting. */
  submittedAt: number | null
  /** Observed p95 operation round time + buffer, pinned at submit so the clock wall is stable. */
  retryClock: TranscriptionRetryClock
  /** Sum of operation.measuredBilledSeconds across all operations (initial + retries). */
  measuredBilledSeconds: number | null
  cogsUsdc6: number | null
  actualMarginBps: number | null
  alertAtUsdc6: number
  abortLimitUsdc6: number
  abortRatio: number
  plannedParts: number
  deliveredParts: number
  evaluatedParts: number
  /** Planned URIs minus URIs returned in any completed operation, and not currently retrying. */
  absentUris: string[]
  wordsDelivered: number | null
  costPerDeliveredWordUsdc6: number | null
  /** Flattened latest part state, updated after each operation is reconciled. */
  parts: TranscriptionJobPart[]
  /** All operations, in order. Retry cost is derived from these, not stored twice. */
  operations: TranscriptionJobOperation[]

  /** Pinned gate config, stored so historical verdicts remain interpretable after retuning. */
  gate: TranscriptionGateConfig

  // ── Retry budget (persisted, transaction-guarded) ──
  retrySpendUsdc6: number
  retryingAt: number | null
  /** The part currently in retryState: 'retrying', if any. Used to exclude it from absentUris while in flight. */
  retryingPartIndex: number | null

  // ── Status ──
  status: TranscriptionJobStatus
  reconcileVerdict: TranscriptionReconcileVerdict | null
  releasedAt: number | null
  createdAt: number
  completedAt: number | null

  // ── User-content count (permanent) ──
  /** Number of overrides skipped during a model change. The overrides themselves are in the workspace. */
  previousOverridesCount: number | null
}

/** Input to `POST /api/transcribe-precision`. */
export interface StartTranscriptionPrecisionRequest {
  mediaId: string
  /** Selected recognizer model. */
  model: MediaTranscriptModel
  /** Optional comma/newline separated glossary terms. */
  glossary?: string
  /** Duration of the source audio in seconds, from the client-side planner. */
  sourceDurationSec: number
  /** Sub-file plan from the client-side planner. */
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

/** One BatchRecognize file result, as the poll reports it. */
export interface TranscriptionBatchFileView {
  inputUri: string
  /** Stored result object; fetched through our own proxy, never handed to the client raw. */
  outputUri: string | null
  billedSeconds: number | null
  errorMessage: string | null
}

/** Output from `GET /api/transcribe-job/[jobId]`. */
export interface GetTranscriptionJobResponse {
  jobId: string
  status: TranscriptionJobStatus
  reconcileVerdict: TranscriptionReconcileVerdict | null
  /** Google operation progress. The stored row keeps saying `running` until reconcile. */
  progressPercent?: number
  /** Per-file results, present once the operation finished. */
  files?: TranscriptionBatchFileView[]
  totalBilledSeconds?: number | null
  errorMessage?: string
  transcript?: {
    text: string
    segments: Array<{
      text: string
      start: number
      end: number
      words?: Array<{
        text: string
        start: number
        end: number
      }>
    }>
  }
}
