/**
 * Merge per-part cloud transcripts into one transcript for the media item.
 *
 * The planner deliberately overlaps consecutive parts, so the tail of one part reappears
 * at the head of the next. Both copies describe the same acoustic event, and keeping both
 * would show the user a stutter. `dedupeTranscriptWords` already encodes the rule for
 * that: same normalised text, overlapping in time, starting within 150 ms — the same check
 * the on-device decoder uses for its overlapping windows.
 *
 * Word offsets arrive relative to their part, and the first word of a stream may have no
 * offsets at all. Both are resolved here: offsets are made absolute, and a word missing
 * them borrows the neighbour's boundary and is marked `timing: 'estimated'` rather than
 * silently starting at zero.
 */
import type { MediaTranscriptSegment, MediaTranscriptWord } from '@/types/storage'
import { dedupeTranscriptWords } from './dedupe-transcript-words'

/** How far back into a part's tail a repeated word may sit and still be recognised as such. */
const OVERLAP_LOOKBACK_SECONDS = 0.2

/** Shortest plausible spoken word, used when neither neighbour can supply a boundary. */
const MIN_ESTIMATED_SECONDS = 0.08
/** Characters per second, for words with no offset on either side. */
const CHARS_PER_SECOND = 16

export interface CloudPartWord {
  word: string
  startSeconds: number | null
  endSeconds: number | null
}

export interface CloudPartSegment {
  /** `spk:0` when diarization was requested, null otherwise. */
  speakerLabel: string | null
  text: string
  words: readonly CloudPartWord[]
}

export interface CloudPartTranscript {
  index: number
  startSec: number
  endSec: number
  overlapSec: number
  segments: readonly CloudPartSegment[]
}

export interface MergedCloudTranscript {
  text: string
  segments: MediaTranscriptSegment[]
  /** Every word in reading order with absolute times, for the word-level editor. */
  words: MediaTranscriptWord[]
  /**
   * Parts that produced no words. A run with entries here is incomplete: the caller should
   * retry those parts rather than present the transcript as whole.
   */
  emptyPartIndexes: number[]
}

function estimatedDuration(text: string): number {
  return Math.max(MIN_ESTIMATED_SECONDS, text.length / CHARS_PER_SECOND)
}

/** Where a word starts: its own offset, else the previous word's end, else the part start. */
function startOf(
  raw: CloudPartWord,
  previous: MediaTranscriptWord | null,
  part: CloudPartTranscript,
): number {
  if (raw.startSeconds !== null) return part.startSec + raw.startSeconds
  return previous?.end ?? part.startSec
}

/** Where a word ends: its own offset, else the next word's start, else a guessed length. */
function endOf(
  raw: CloudPartWord,
  next: CloudPartWord | null,
  part: CloudPartTranscript,
  start: number,
): number {
  if (raw.endSeconds !== null) return part.startSec + raw.endSeconds
  const nextStart =
    next?.startSeconds !== null && next?.startSeconds !== undefined
      ? part.startSec + next.startSeconds
      : null
  return nextStart ?? start + estimatedDuration(raw.word)
}

/** One part's words with absolute times, filling in boundaries the model omitted. */
function absoluteWords(
  segment: CloudPartSegment,
  part: CloudPartTranscript,
): MediaTranscriptWord[] {
  const words: MediaTranscriptWord[] = []

  for (let index = 0; index < segment.words.length; index++) {
    const raw = segment.words[index]
    if (!raw || raw.word.length === 0) continue

    const start = startOf(raw, words.at(-1) ?? null, part)
    const end = Math.max(endOf(raw, segment.words[index + 1] ?? null, part, start), start)
    const estimated = raw.startSeconds === null || raw.endSeconds === null

    words.push({
      text: raw.word,
      start,
      end,
      ...(estimated ? { timing: 'estimated' as const } : {}),
    })
  }

  return words
}

/**
 * Merge parts in index order.
 *
 * Each part's words are deduplicated against the previous part's tail only — the window
 * where the two transcripts can describe the same speech. Comparing against everything
 * would let a repeated phrase later in the recording cancel real speech.
 */
export function mergePartTranscripts(parts: readonly CloudPartTranscript[]): MergedCloudTranscript {
  const ordered = [...parts].sort((left, right) => left.index - right.index)
  const segments: MediaTranscriptSegment[] = []
  const words: MediaTranscriptWord[] = []
  const emptyPartIndexes: number[] = []
  let previousTail: MediaTranscriptWord[] = []

  for (const part of ordered) {
    let partWordCount = 0
    // Only the overlap can repeat, so anything ending before it is safe from dedupe.
    const overlapStart = part.endSec - part.overlapSec - OVERLAP_LOOKBACK_SECONDS

    for (const segment of part.segments) {
      const kept = dedupeTranscriptWords(absoluteWords(segment, part), previousTail)
      if (kept.length === 0) continue

      partWordCount += kept.length
      segments.push({
        text: kept.map((word) => word.text).join(' '),
        start: kept[0]!.start,
        end: kept[kept.length - 1]!.end,
        words: kept,
        ...(segment.speakerLabel ? { speaker: segment.speakerLabel } : {}),
      })
      words.push(...kept)
    }

    if (partWordCount === 0) emptyPartIndexes.push(part.index)
    previousTail = words.filter((word) => word.end > overlapStart)
  }

  return {
    text: segments.map((segment) => segment.text).join(' '),
    segments,
    words,
    emptyPartIndexes,
  }
}
