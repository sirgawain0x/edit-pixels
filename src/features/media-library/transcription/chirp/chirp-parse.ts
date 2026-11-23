/**
 * Chirp 3 BatchRecognize — parse, sanitize, stitch, reconcile.
 *
 * Pure functions, no network. Every rule here comes from a measured behaviour of the
 * live API (see the fixtures in this directory, captured 2026-11-22):
 *   - offsets are strings with an `s` suffix, chunk-relative, and NOT reliably monotonic
 *     (real output contained a word stamped 54214.16s inside a 1140s file, and one entry
 *     with start 11519.04s / end 179.04s -> negative span)
 *   - a failed part has NO metadata at all (null), never a zero
 *   - a mixed batch (3 good + 1 over-limit) reports done:true, no operation error, and a
 *     job-level totalBilledDuration equal to the sum of the good parts only
 *   - billing is whole seconds per request, rounded up (540.876s file -> 541s)
 */

export interface ChirpWordAnnotation {
  startOffset?: string | number | null
  endOffset?: string | number | null
  word?: string
  speakerLabel?: string
}

export interface ParsedWord {
  text: string
  start: number
  end: number
  speaker?: string
}

export interface PartPlan {
  uri: string
  startSec: number
  endSec: number
  overlap?: number
  estimateSeconds?: number | null
}

export interface ReconciledPart extends PartPlan {
  index: number
  billedSecondsMeasured: number | null
  estimateSeconds: number | null
  verdict: PartVerdict
  errorMessage: string | null
  resultUri: string | null
}

export type PartVerdict =
  | 'absent'
  | 'failed'
  | 'failed-unbilled'
  | 'billed-under-estimate'
  | 'billed-over-estimate'
  | 'exact'

export type ReconcileVerdict =
  | 'missing-billing'
  | 'submit-failure'
  | 'integrity-mismatch'
  | 'failed-parts'
  | 'plan-error'
  | 'drift'
  | 'exact'

export interface ReconcileResult {
  verdict: ReconcileVerdict
  precedence: number
  plannedParts: number
  deliveredParts: number
  absentUris: string[]
  jobLevelSeconds: number | null
  measuredBilledSeconds: number
  parts: ReconciledPart[]
}

export type QualityVerdict = 'healthy' | 'suspect' | 'truncated' | 'vad-uncertain' | 'not-evaluated'
export type QualityFlag = 'under-detected' | 'no-silence' | null

export interface CoverageResult {
  evaluated: boolean
  reason?: string
  tokensPerSpeechSecond: number
  coverage: number | null
  speechRatio: number | null
  suppressedFlag?: QualityFlag
  verdict: QualityVerdict
  flag: QualityFlag
}

export interface Segment {
  start: number
  end: number
  text: string
  words: ParsedWord[]
  speaker?: string
}

export interface Seam {
  index: number
  windowStart: number
  windowEnd: number
  overlap: number
  droppedFromPrevious?: number
}

export interface StitchResult {
  words: ParsedWord[]
  seams: Seam[]
}

/** Parse `"1140s"` -> 1140. Absent/null -> null. Never coerce absence to zero. */
export function parseSeconds(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(String(value).trim())
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

const VERDICT_PRECEDENCE: ReconcileVerdict[] = [
  'missing-billing',
  'submit-failure',
  'integrity-mismatch',
  'failed-parts',
  'plan-error',
  'drift',
  'exact',
]

function partVerdict(
  result: unknown,
  error: unknown,
  billedSecondsMeasured: number | null,
  estimateSeconds: number | null,
): PartVerdict {
  if (!result) return 'absent'
  if (error) return 'failed'
  if (billedSecondsMeasured === null) return 'failed-unbilled'
  if (estimateSeconds !== null && billedSecondsMeasured < estimateSeconds)
    return 'billed-under-estimate'
  if (estimateSeconds !== null && billedSecondsMeasured > estimateSeconds)
    return 'billed-over-estimate'
  return 'exact'
}

function resultError(result: unknown): { message?: string } | null {
  if (!result || typeof result !== 'object') return null
  return (result as { error?: { message?: string } }).error ?? null
}

function resultMetadata(result: unknown): { totalBilledDuration?: string | number } | null {
  if (!result || typeof result !== 'object') return null
  const metadata = (result as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== 'object') return null
  return metadata as { totalBilledDuration?: string | number }
}

function resultUri(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as { cloudStorageResult?: { uri?: string }; uri?: string }
  return r.cloudStorageResult?.uri ?? r.uri ?? null
}

/**
 * Reconcile an operation response against the planned parts.
 *
 * Precedence matters: a failed part is unbilled, so a 2-part job with one rejection shows
 * a NEGATIVE drift. Evaluating drift first would fire "we planned this wrong" on the most
 * common failure mode. Failure signals must be consumed before drift is interpreted.
 */
export function reconcileOperation({
  operation,
  plannedParts,
}: {
  operation: {
    response?: { totalBilledDuration?: string | number; results?: Record<string, unknown> }
  } | null
  plannedParts: PartPlan[]
}): ReconcileResult {
  const response = operation?.response ?? null
  const results = response?.results ?? {}

  const plannedUris = plannedParts.map((part) => part.uri)
  const returnedUris = Object.keys(results)
  const absentUris = plannedUris.filter((uri) => !(uri in results))

  const jobLevelSeconds = parseSeconds(response?.totalBilledDuration)

  const parts = plannedParts.map((part, index): ReconciledPart => {
    const result = results[part.uri] ?? null
    const error = resultError(result)
    const billedSecondsMeasured = parseSeconds(resultMetadata(result)?.totalBilledDuration)
    const estimateSeconds = part.estimateSeconds ?? null
    const verdict = partVerdict(result, error, billedSecondsMeasured, estimateSeconds)

    return {
      ...part,
      index,
      billedSecondsMeasured,
      estimateSeconds,
      verdict,
      errorMessage: error?.message ?? null,
      resultUri: resultUri(result),
    }
  })

  const billedParts = parts.filter((part) => part.billedSecondsMeasured !== null)
  const measuredBilledSeconds = billedParts.reduce(
    (sum, part) => sum + (part.billedSecondsMeasured ?? 0),
    0,
  )
  const deliveredParts = parts.filter(
    (part) => part.verdict === 'exact' || part.verdict === 'billed-over-estimate',
  ).length
  const overBilled = parts.some((part) => part.verdict === 'billed-over-estimate')
  const underBilled = parts.some((part) => part.verdict === 'billed-under-estimate')
  const anyFailed = parts.some(
    (part) =>
      part.verdict === 'failed' || part.verdict === 'failed-unbilled' || part.verdict === 'absent',
  )

  let verdict: ReconcileVerdict
  if (jobLevelSeconds === null) verdict = 'missing-billing'
  else if (returnedUris.length === 0) verdict = 'submit-failure'
  else if (absentUris.length > 0) verdict = 'integrity-mismatch'
  else if (jobLevelSeconds !== measuredBilledSeconds) verdict = 'integrity-mismatch'
  else if (anyFailed) verdict = 'failed-parts'
  else if (underBilled) verdict = 'plan-error'
  else if (overBilled) verdict = 'drift'
  else verdict = 'exact'

  return {
    verdict,
    precedence: VERDICT_PRECEDENCE.indexOf(verdict),
    plannedParts: plannedParts.length,
    deliveredParts,
    absentUris,
    jobLevelSeconds,
    measuredBilledSeconds,
    parts,
  }
}

/**
 * Normalize one part's word annotations into absolute-time words.
 *
 * Rules from measurement:
 *   - parse the `s` suffix
 *   - add the part's start offset (offsets are part-relative)
 *   - drop words outside [partStart, partStart + partDuration] (tolerance for tail jitter)
 *   - drop negative or inverted spans
 *   - sort: real outputs are not monotonic
 */
export function sanitizePartWords({
  words,
  partStartSec,
  partDurationSec,
  speakerLabels = true,
}: {
  words?: ChirpWordAnnotation[]
  partStartSec: number
  partDurationSec: number
  speakerLabels?: boolean
}): { words: ParsedWord[]; dropped: number } {
  const limit = partStartSec + partDurationSec + 0.5
  const kept: ParsedWord[] = []
  let dropped = 0

  for (const word of words ?? []) {
    const start = parseSeconds(word.startOffset)
    const end = parseSeconds(word.endOffset)
    const text = typeof word.word === 'string' ? word.word : ''
    if (start === null || end === null || !text) {
      dropped += 1
      continue
    }
    if (end <= start) {
      dropped += 1
      continue
    }
    const absoluteStart = partStartSec + start
    const absoluteEnd = partStartSec + end
    if (absoluteStart < partStartSec - 0.5 || absoluteEnd > limit) {
      dropped += 1
      continue
    }
    kept.push({
      text,
      start: absoluteStart,
      end: absoluteEnd,
      ...(speakerLabels && word.speakerLabel != null ? { speaker: word.speakerLabel } : {}),
    })
  }

  kept.sort((a, b) => a.start - b.start)
  return { words: kept, dropped }
}

interface StitchPart {
  startSec: number
  endSec: number
  words: ParsedWord[]
}

/**
 * Join sanitized parts into one timeline.
 *
 * Seam handling: part k+1 starts `overlap` seconds before part k ends, so the duplicated
 * window is [start[k+1], end[k]]. Keep the earlier part's words below the window midpoint
 * and the later part's words at or above it — no duplicate tokens, no gap larger than
 * overlap/2.
 */
export function stitchParts({
  parts,
  overlapSec,
}: {
  parts: StitchPart[]
  overlapSec?: number
}): StitchResult {
  if (parts.length === 0) return { words: [], seams: [] }

  const seams: Seam[] = []
  const output: ParsedWord[] = [...parts[0]!.words]

  for (let index = 1; index < parts.length; index += 1) {
    const previous = parts[index - 1]!
    const current = parts[index]!
    const windowStart = current.startSec
    const windowEnd = previous.endSec
    const midpoint = (windowStart + windowEnd) / 2
    const duplicateWindow = windowEnd - windowStart
    const seam: Seam = {
      index,
      windowStart,
      windowEnd,
      overlap: Math.max(overlapSec ?? 0, duplicateWindow),
    }
    seams.push(seam)

    const keptFromPrevious = output.filter((word) => word.start < midpoint)
    const droppedFromPrevious = output.length - keptFromPrevious.length
    const keptFromCurrent = current.words.filter((word) => word.start >= midpoint)

    output.length = 0
    output.push(...keptFromPrevious, ...keptFromCurrent)
    seam.droppedFromPrevious = droppedFromPrevious
  }

  return { words: output, seams }
}

/**
 * Transcript plausibility gate, calibrated against real Chirp output.
 *
 * Measured on live fixtures (tokens per VAD speech second):
 *   healthy continuous speech   2.23 / 2.61
 *   ITN-dense numbers (worst)   1.45
 *   truncated AND timestamp-stretched   0.77
 *
 * Two things this replaced, both measured rather than assumed:
 *   - words per MINUTE of file duration: breaks when trailing silence pads the file
 *     (1.18/s vs 2.61/s for identical speech), so the denominator must be VAD speech.
 *   - span coverage alone: a truncated transcript gets its timestamps stretched across the
 *     whole file, so coverage reads 0.9+ and passes. Coverage cannot catch truncation.
 *   - median inter-word gap: measured 0.00s everywhere (words tile contiguously); useless.
 */
export function speechSpanCoverage({
  words,
  vadSpeechSeconds,
  partDurationSec = null,
  forcedCut = false,
}: {
  words?: ParsedWord[]
  vadSpeechSeconds: number
  partDurationSec?: number | null
  forcedCut?: boolean
}): CoverageResult {
  if (!words?.length || !(vadSpeechSeconds > 0)) {
    return {
      evaluated: false,
      tokensPerSpeechSecond: 0,
      coverage: null,
      speechRatio:
        partDurationSec && partDurationSec > 0 ? vadSpeechSeconds / partDurationSec : null,
      verdict: 'not-evaluated',
      flag: null,
    }
  }

  const spans = words.map((word) => [word.start, word.end] as const).sort((a, b) => a[0] - b[0])

  let covered = 0
  let cursor = -Infinity
  for (const [start, end] of spans) {
    const from = Math.max(start, cursor)
    if (end > from) {
      covered += end - from
      cursor = end
    }
  }

  // Minimum sample size. Token count is Poisson-ish: at ~2.5 tokens/s a 10s part holds ~25
  // tokens, so its ratio has a 1-sigma spread of ~0.5 — wider than the whole 1.4-1.8 band.
  // 120s of speech gives ~300 tokens and a spread of ~0.14, which fits inside the band.
  const minGateSpeechSeconds = 120
  if (vadSpeechSeconds < minGateSpeechSeconds) {
    return {
      evaluated: false,
      reason: 'sample-too-small',
      tokensPerSpeechSecond: words.length / vadSpeechSeconds,
      coverage: null,
      speechRatio:
        partDurationSec && partDurationSec > 0 ? vadSpeechSeconds / partDurationSec : null,
      verdict: 'not-evaluated',
      flag: null,
    }
  }

  const tokensPerSpeechSecond = words.length / vadSpeechSeconds
  const coverage = covered / vadSpeechSeconds
  const speechRatio =
    partDurationSec && partDurationSec > 0 ? vadSpeechSeconds / partDurationSec : null

  const baseVerdict: QualityVerdict =
    tokensPerSpeechSecond >= 1.8
      ? 'healthy'
      : tokensPerSpeechSecond >= 1.4
        ? 'suspect'
        : 'truncated'

  // Impossible for a real recording to sustain more than ~4.5 tokens/second of detected speech:
  // the denominator missed speech, so the output may well be complete. This check runs FIRST,
  // before the no-silence branch, because a broken denominator outranks a forced-cut heuristic.
  if (tokensPerSpeechSecond > 4.5) {
    return {
      evaluated: true,
      tokensPerSpeechSecond,
      coverage,
      speechRatio,
      verdict: 'vad-uncertain',
      flag: 'under-detected',
    }
  }

  // No real recording is ~100% speech (measured max 0.896 long-form, 0.944 on a 6s clip).
  // With a healthy token rate that is a broken VAD -> undecidable; with a low rate it is a
  // GENUINE truncation, because an over-detecting denominator cannot explain the shortfall.
  if (speechRatio !== null && speechRatio > 0.98) {
    // A part the planner forced a mid-speech cut on has no silence by construction, so
    // "no-silence" is expected there and is not evidence of a broken VAD. Suppress the flag
    // but RECORD it: the verdict still comes from the token rate, and the audit trail keeps
    // the fact that this part was 100% speech.
    if (forcedCut) {
      return {
        evaluated: true,
        tokensPerSpeechSecond,
        coverage,
        speechRatio,
        suppressedFlag: 'no-silence',
        verdict: tokensPerSpeechSecond < 1.4 ? 'truncated' : baseVerdict,
        flag: null,
      }
    }
    if (tokensPerSpeechSecond < 1.4) {
      return {
        evaluated: true,
        tokensPerSpeechSecond,
        coverage,
        speechRatio,
        verdict: 'truncated',
        flag: 'no-silence',
      }
    }
    return {
      evaluated: true,
      tokensPerSpeechSecond,
      coverage,
      speechRatio,
      verdict: 'vad-uncertain',
      flag: 'no-silence',
    }
  }

  return {
    evaluated: true,
    tokensPerSpeechSecond,
    coverage,
    speechRatio,
    verdict: baseVerdict,
    flag: null,
  }
}

/**
 * Synthesize cutter-ready segments from a flat word list. Chirp returns words only — the
 * transcript editor needs segment rows, so break on speaker change, long pause, or length.
 */
export function segmentsFromWords({
  words,
  gapSec = 0.6,
  maxLenSec = 12,
}: {
  words: ParsedWord[]
  gapSec?: number
  maxLenSec?: number
}): Segment[] {
  const segments: Segment[] = []
  let current: Segment | null = null

  for (const word of words) {
    const breakBefore =
      current === null ||
      (word.speaker !== undefined &&
        current.speaker !== undefined &&
        word.speaker !== current.speaker) ||
      word.start - current.end > gapSec ||
      word.end - current.start > maxLenSec

    if (breakBefore && current) {
      segments.push(current)
      current = null
    }
    if (!current) {
      current = {
        start: word.start,
        end: word.end,
        text: word.text,
        words: [word],
        ...(word.speaker ? { speaker: word.speaker } : {}),
      }
    } else {
      current.end = word.end
      current.text = `${current.text} ${word.text}`
      current.words.push(word)
    }
  }
  if (current) segments.push(current)

  // Emit every segment. A length filter would silently drop words, and a short segment is
  // still a legitimate cut target — grouping is the editor's decision, not the parser's.
  return segments
}
