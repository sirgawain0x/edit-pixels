import { describe, expect, it } from 'vite-plus/test'
import { dedupeTranscriptWords } from './dedupe-transcript-words'

describe('dedupeTranscriptWords', () => {
  const recent = [{ text: 'No,', start: 1, end: 1.3 }]
  it('keeps nearby, touching, and slightly overlapping genuine repeats', () => {
    for (const start of [1.25, 1.3, 1.4]) {
      const words = [{ text: 'no', start, end: start + 0.3 }]
      expect(dedupeTranscriptWords(words, recent)).toEqual(words)
    }
  })
  it('drops the same acoustic event decoded again with minor timing drift', () => {
    expect(dedupeTranscriptWords([{ text: 'no', start: 1.02, end: 1.31 }], recent)).toEqual([])
  })
  it('preserves different words and repeats within the current window', () => {
    const words = [
      { text: 'yes', start: 1, end: 1.3 },
      { text: 'no', start: 2, end: 2.2 },
      { text: 'no', start: 2.2, end: 2.5 },
    ]
    expect(dedupeTranscriptWords(words, recent)).toEqual(words)
  })
})
