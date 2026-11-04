import type {
  MediaTranscript,
  MediaTranscriptSegment,
  MediaTranscriptWord,
  TranscriptWordOverride,
} from '@/types/storage'
import { joinTranscriptWords } from './transcript-text'

export interface TranscriptWordCorrection {
  start: number
  end: number
  text: string
  expectedUpdatedAt: number
  /** Contiguous indices in the transcript flat word list; authoritative when set. */
  indices?: number[]
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end
}

/**
 * Treat a word as selected when its midpoint lies in the interval.
 * Whisper word timings often overlap by tens of milliseconds at boundaries;
 * any-touch overlap would include the next word when editing one token.
 */
export function wordIsInSelectedInterval(
  word: { start: number; end: number },
  selectionStart: number,
  selectionEnd: number,
): boolean {
  const midpoint = (word.start + word.end) / 2
  return midpoint >= selectionStart && midpoint <= selectionEnd
}

function collectTimedWords(transcript: MediaTranscript): MediaTranscriptWord[] {
  return transcript.segments
    .flatMap((segment) => segment.words ?? [])
    .toSorted((a, b) => a.start - b.start)
}

function assertContiguousIndices(indices: readonly number[]): boolean {
  if (!indices.length) return false
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1]! + 1) return false
  }
  return true
}

/** Reapply saved text without trusting new ASR token indices or text. */
export function applyTranscriptCorrections(
  segments: readonly MediaTranscriptSegment[],
  overrides: readonly TranscriptWordOverride[],
): MediaTranscriptSegment[] {
  let result = segments.map((segment) => ({
    ...segment,
    words: segment.words?.map((w) => ({ ...w })),
  }))
  for (const override of overrides) {
    // Keep the correction even when a new recognizer misses this speech entirely.
    result = result.flatMap((segment) => {
      if (!segment.words?.length) return overlaps(segment, override) ? [] : [segment]
      if (!segment.words.some((word) => overlaps(word, override))) return [segment]
      const before = segment.words.filter((word) => {
        const midpoint = (word.start + word.end) / 2
        return midpoint < override.start
      })
      const after = segment.words.filter((word) => {
        const midpoint = (word.start + word.end) / 2
        return midpoint > override.end
      })
      return [before, after]
        .filter((words) => words.length > 0)
        .map((words) => ({
          ...segment,
          words,
          text: joinTranscriptWords(words.map((word) => word.text)),
          start: words[0]!.start,
          end: words.at(-1)!.end,
        }))
    })
    result.push({
      start: override.start,
      end: override.end,
      text: override.text,
      words: override.words.map((word) => ({ ...word })),
    })
  }
  return result.toSorted((a, b) => a.start - b.start)
}

/** One confirmed edit; same-count changes retain every original word boundary. */
export function correctTranscriptWords(
  transcript: MediaTranscript,
  correction: TranscriptWordCorrection,
): MediaTranscript {
  if (transcript.updatedAt !== correction.expectedUpdatedAt) {
    throw new Error('The transcript changed. Select the words again before saving.')
  }
  const { start, end } = correction
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error('Select a valid spoken range to correct.')
  }
  const text = correction.text.trim().replace(/\s+/gu, ' ')
  if (!text) throw new Error('Enter corrected words. Use Mark for delete to remove speech.')
  const allWords = collectTimedWords(transcript)
  let original: MediaTranscriptWord[]
  if (correction.indices?.length) {
    const indices = [...correction.indices].sort((a, b) => a - b)
    if (!assertContiguousIndices(indices)) {
      throw new Error('Select a valid spoken range to correct.')
    }
    if (indices.some((index) => index < 0 || index >= allWords.length)) {
      throw new Error('No timed words found in this range.')
    }
    original = indices.map((index) => allWords[index]!)
  } else {
    original = allWords.filter((word) =>
      wordIsInSelectedInterval(word, correction.start, correction.end),
    )
  }
  if (!original.length) throw new Error('No timed words found in this range.')

  // Preserve punctuation/CJK tokens as one unit when editing one original token.
  const parts = text.split(/\s+/u)
  const preserved = parts.length === original.length
  const range = { start: original[0]!.start, end: original.at(-1)!.end }
  const words: MediaTranscriptWord[] = parts.map((part, index) => ({
    text: part,
    start: preserved
      ? original[index]!.start
      : range.start + ((range.end - range.start) * index) / parts.length,
    end: preserved
      ? original[index]!.end
      : range.start + ((range.end - range.start) * (index + 1)) / parts.length,
    edited: true,
    ...(!preserved || original[index]?.timing === 'estimated'
      ? { timing: 'estimated' as const }
      : {}),
  }))
  const override: TranscriptWordOverride = {
    ...range,
    text,
    words,
    timing:
      preserved && original.every((word) => word.timing !== 'estimated')
        ? 'preserved'
        : 'estimated',
    sourceVersionAt: transcript.updatedAt,
  }
  // Earlier corrections may cover a wider phrase. Keep their unaffected words;
  // replacing the whole old override would resurrect those corrections on refresh.
  const overrides = (transcript.overrides ?? []).flatMap((existing) => {
    if (!overlaps(existing, range)) return [existing]
    return existing.words
      .filter((word) => !overlaps(word, range))
      .map((word) => ({
        ...existing,
        start: word.start,
        end: word.end,
        text: word.text,
        words: [word],
      }))
  })
  overrides.push(override)
  const segments = applyTranscriptCorrections(transcript.segments, [override])
  return {
    ...transcript,
    segments,
    overrides,
    text: joinTranscriptWords(segments.map((segment) => segment.text)),
    updatedAt: Math.max(Date.now(), transcript.updatedAt + 1),
  }
}
