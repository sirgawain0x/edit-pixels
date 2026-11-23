/**
 * Drive one Precision (cloud) transcription from plan to saved transcript.
 *
 * The order matters and is not negotiable: plan, quote, pay, upload, submit, then one request
 * per part. Uploading before paying would put the user's audio in a bucket for a job that may
 * never be paid for, and submitting before every part landed would let Google bill for a run
 * with a hole in it.
 *
 * Every side effect arrives as a dependency, so the whole sequence — including the two ways it
 * can fail and be retried — is testable without a wallet, a network, or a browser.
 */
import type { MediaTranscript, MediaTranscriptModel } from '../../../../types/storage'
import {
  mergePartTranscripts,
  type CloudPartSegment,
  type CloudPartTranscript,
  type MergedCloudTranscript,
} from './merge-part-transcripts'
import { saveCloudTranscript } from './save-cloud-transcript'

/** One sub-file: where it starts and ends in the source, and how much it shares with its neighbour. */
export interface PrecisionPart {
  startSec: number
  endSec: number
  overlapSec: number
}

export interface PrecisionPlan {
  /** Part N is `parts[N]`; the index is positional, so the two can never disagree. */
  parts: PrecisionPart[]
  sourceDurationSec: number
}

export interface PrecisionQuote {
  jobId: string
  /** True when the monthly free run covers this job, so no payment is sent. */
  free: boolean
  priceUsd: number
}

export interface UploadedPart {
  index: number
  uri: string
}

/** What one part request returns: speaker-tagged segments with part-relative offsets. */
export interface PartResult {
  segments: readonly CloudPartSegment[]
}

export interface PrecisionDeps {
  plan: () => Promise<PrecisionPlan>
  quote: (plan: PrecisionPlan) => Promise<PrecisionQuote>
  /** Resolve with the tx hash once the payment is mined; throw if the user declines. */
  pay: (quote: PrecisionQuote) => Promise<string>
  upload: (jobId: string, parts: PrecisionPart[]) => Promise<UploadedPart[]>
  submit: (input: { jobId: string; txHash: string | null; files: UploadedPart[] }) => Promise<void>
  transcribePart: (input: { jobId: string; partIndex: number; uri: string }) => Promise<PartResult>
  /** Overrides the default `saveCloudTranscript` write, for tests. */
  save?: (merged: MergedCloudTranscript, model: MediaTranscriptModel) => Promise<MediaTranscript>
  onProgress?: (stage: PrecisionStage, fraction: number) => void
}

export type PrecisionStage =
  | 'planning'
  | 'quoting'
  | 'paying'
  | 'uploading'
  | 'submitting'
  | 'transcribing'
  | 'saving'

/** A part failed twice. `partIndex` is the retry handle: the caller can resume from it. */
export class PrecisionPartError extends Error {
  constructor(
    readonly partIndex: number,
    readonly cause?: unknown,
  ) {
    super(`Precision part ${partIndex} failed twice`)
    this.name = 'PrecisionPartError'
  }
}

/**
 * The run produced a transcript with gaps. Saving it would present a partial recording as
 * complete, so the whole run fails and the caller decides whether to retry the empty parts.
 */
export class IncompleteTranscriptError extends Error {
  constructor(readonly emptyPartIndexes: number[]) {
    super(`Precision run left ${emptyPartIndexes.length} part(s) empty`)
    this.name = 'IncompleteTranscriptError'
  }
}

/** A part with no words at all: the model occasionally returns one for audio that has speech. */
function hasWords(result: PartResult): boolean {
  return result.segments.some((segment) => segment.words.length > 0)
}

/** One retry: a part failure is usually a transient 5xx, not a bad recording. */
const PART_ATTEMPTS = 2

/**
 * Ask for one part, retrying once whether the request threw or came back with no words.
 *
 * A thrown failure and an empty answer need the same response — try again — but they do not
 * need the same verdict when the retry also fails: a part that keeps throwing is an error the
 * caller can resume from, while a part that keeps answering nothing is a gap in the
 * transcript, which the merge reports by index. Collapsing the two would either hide a gap or
 * throw away a run that only had one silent part.
 */
async function requestPart(
  deps: PrecisionDeps,
  input: { jobId: string; partIndex: number; uri: string },
): Promise<{ result: PartResult | null; failure: unknown }> {
  let result: PartResult | null = null
  let failure: unknown = null

  for (let attempt = 0; attempt < PART_ATTEMPTS; attempt += 1) {
    try {
      result = await deps.transcribePart(input)
      if (hasWords(result)) return { result, failure: null }
    } catch (error) {
      failure = error
    }
  }

  return { result, failure }
}

/**
 * Transcribe every part, in order.
 *
 * Order matters: the merge dedupes each part against the one before it, so running parts
 * concurrently would make the transcript depend on which request finished first. The
 * serverless ceiling applies per request, not per run.
 */
async function transcribeParts(
  deps: PrecisionDeps,
  jobId: string,
  files: readonly UploadedPart[],
  parts: readonly PrecisionPart[],
): Promise<CloudPartTranscript[]> {
  const results: CloudPartTranscript[] = []

  for (const [position, file] of files.entries()) {
    deps.onProgress?.('transcribing', position / files.length)
    const part = parts[file.index]
    if (!part) throw new PrecisionPartError(file.index)

    const { result, failure } = await requestPart(deps, {
      jobId,
      partIndex: file.index,
      uri: file.uri,
    })
    // Every attempt threw: the part never produced an answer, so there is nothing to merge.
    if (!result) throw new PrecisionPartError(file.index, failure)

    results.push({ index: file.index, ...part, segments: result.segments })
  }

  return results
}

/**
 * Run a Precision transcription end to end and return the saved transcript.
 *
 * The result is the same shape the on-device path writes, because both go through
 * `saveTranscript`: switching tiers must not change what the rest of the app reads.
 */
export async function runPrecisionJob(
  deps: PrecisionDeps,
  options: { mediaId: string; model: MediaTranscriptModel },
): Promise<MediaTranscript> {
  deps.onProgress?.('planning', 0)
  const plan = await deps.plan()

  deps.onProgress?.('quoting', 0)
  const quote = await deps.quote(plan)

  // A free run is paid for by the allowance, so paying again would double-charge.
  let txHash: string | null = null
  if (!quote.free) {
    deps.onProgress?.('paying', 0)
    txHash = await deps.pay(quote)
  }

  deps.onProgress?.('uploading', 0)
  const files = await deps.upload(quote.jobId, plan.parts)

  deps.onProgress?.('submitting', 0)
  await deps.submit({ jobId: quote.jobId, txHash, files })

  const transcripts = await transcribeParts(deps, quote.jobId, files, plan.parts)

  const merged = mergePartTranscripts(transcripts)
  if (merged.emptyPartIndexes.length > 0) {
    throw new IncompleteTranscriptError(merged.emptyPartIndexes)
  }

  deps.onProgress?.('saving', 0)
  const save =
    deps.save ??
    ((result: MergedCloudTranscript, model: MediaTranscriptModel) =>
      saveCloudTranscript({ mediaId: options.mediaId, merged: result, model }))
  return save(merged, options.model)
}
