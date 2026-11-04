import type { TranscriptWord } from '../types'

function normalize(text: string): string {
  return text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/** Only suppress the same acoustic event from overlapping decoding windows.
 * Nearby matching text alone is insufficient: "no, no" is valid speech.
 */
export function dedupeTranscriptWords(
  words: readonly TranscriptWord[],
  recentWords: readonly TranscriptWord[],
): TranscriptWord[] {
  return words.filter((word) => {
    const text = normalize(word.text)
    if (!text) return true
    return !recentWords.some((recent) => {
      if (normalize(recent.text) !== text) return false
      const overlap = Math.min(word.end, recent.end) - Math.max(word.start, recent.start)
      const duration = Math.max(word.end - word.start, recent.end - recent.start)
      return (
        duration > 0 && overlap / duration >= 0.65 && Math.abs(word.start - recent.start) <= 0.15
      )
    })
  })
}
