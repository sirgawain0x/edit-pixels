import { describe, expect, it } from 'vite-plus/test'
import type { MediaTranscript } from '@/types/storage'
import { applyTranscriptCorrections, correctTranscriptWords } from './transcript-corrections'

const transcript: MediaTranscript = {
  id: 'm',
  mediaId: 'm',
  model: 'parakeet-tdt-v3',
  quantization: 'hybrid',
  text: 'Hello wrong world',
  createdAt: 1,
  updatedAt: 2,
  segments: [
    {
      start: 0,
      end: 3,
      text: 'Hello wrong world',
      words: [
        { text: 'Hello', start: 0, end: 0.5 },
        { text: 'wrong', start: 1, end: 1.5 },
        { text: 'world', start: 2, end: 3 },
      ],
    },
  ],
}

describe('transcript corrections', () => {
  it('preserves exact timing, surrounding text order, and the input record', () => {
    const updated = correctTranscriptWords(transcript, {
      start: 1,
      end: 1.5,
      text: 'beautiful',
      expectedUpdatedAt: 2,
    })
    expect(updated.text).toBe('Hello beautiful world')
    expect(updated.segments.flatMap((segment) => segment.words ?? [])[1]).toEqual({
      text: 'beautiful',
      start: 1,
      end: 1.5,
      edited: true,
    })
    expect(updated.overrides?.[0]?.timing).toBe('preserved')
    expect(updated.updatedAt).toBeGreaterThan(2)
    expect(transcript.text).toBe('Hello wrong world')
  })

  it('marks changed word counts as estimated within the original source interval', () => {
    const updated = correctTranscriptWords(transcript, {
      start: 1,
      end: 1.5,
      text: 'very beautiful',
      expectedUpdatedAt: 2,
    })
    expect(updated.text).toBe('Hello very beautiful world')
    expect(updated.overrides?.[0]).toMatchObject({ start: 1, end: 1.5, timing: 'estimated' })
    expect(updated.overrides?.[0]?.words).toEqual([
      { text: 'very', start: 1, end: 1.25, edited: true, timing: 'estimated' },
      { text: 'beautiful', start: 1.25, end: 1.5, edited: true, timing: 'estimated' },
    ])
  })

  it('does not replace neighboring whisper-overlap words when correcting one token', () => {
    const overlapping: MediaTranscript = {
      ...transcript,
      text: 'Hello very wrong world',
      segments: [
        {
          start: 0,
          end: 3,
          text: 'Hello very wrong world',
          words: [
            { text: 'Hello', start: 0, end: 0.5 },
            { text: 'very', start: 0.98, end: 1.2 },
            { text: 'wrong', start: 1.2, end: 1.52 },
            { text: 'world', start: 2, end: 3 },
          ],
        },
      ],
    }
    const updated = correctTranscriptWords(overlapping, {
      start: 1.2,
      end: 1.52,
      text: 'beautiful',
      expectedUpdatedAt: 2,
    })
    expect(updated.text).toBe('Hello very beautiful world')
    expect(updated.overrides?.[0]).toMatchObject({ start: 1.2, end: 1.52, timing: 'preserved' })
  })

  it('reapplies corrections after recognizer segmentation and word counts change', () => {
    const updated = correctTranscriptWords(transcript, {
      start: 1,
      end: 1.5,
      text: 'beautiful',
      expectedUpdatedAt: 2,
    })
    const regenerated = [
      {
        start: 0,
        end: 3,
        text: 'Hello very wrong world',
        words: [
          { text: 'Hello', start: 0, end: 0.5 },
          { text: 'very', start: 0.98, end: 1.2 },
          { text: 'wrong', start: 1.2, end: 1.52 },
          { text: 'world', start: 2, end: 3 },
        ],
      },
    ]
    expect(
      applyTranscriptCorrections(regenerated, updated.overrides!)
        .map((segment) => segment.text)
        .join(' '),
    ).toBe('Hello beautiful world')
    expect(applyTranscriptCorrections([], updated.overrides!)[0]?.text).toBe('beautiful')
  })

  it('keeps unaffected corrections when editing part of a corrected phrase again', () => {
    const phrase = correctTranscriptWords(transcript, {
      start: 1,
      end: 3,
      text: 'lovely planet',
      expectedUpdatedAt: 2,
    })
    const updated = correctTranscriptWords(phrase, {
      start: 1,
      end: 1.5,
      text: 'beautiful',
      expectedUpdatedAt: phrase.updatedAt,
    })
    expect(
      applyTranscriptCorrections(transcript.segments, updated.overrides!)
        .map((segment) => segment.text)
        .join(' '),
    ).toBe('Hello beautiful planet')
  })

  it('rejects stale, empty, invalid, and untimed edits', () => {
    expect(() =>
      correctTranscriptWords(transcript, { start: 1, end: 1.5, text: 'new', expectedUpdatedAt: 1 }),
    ).toThrow('changed')
    expect(() =>
      correctTranscriptWords(transcript, { start: 1, end: 1.5, text: ' ', expectedUpdatedAt: 2 }),
    ).toThrow('Mark for delete')
    expect(() =>
      correctTranscriptWords(transcript, { start: 8, end: 9, text: 'new', expectedUpdatedAt: 2 }),
    ).toThrow('No timed words')
    expect(() =>
      correctTranscriptWords(transcript, { start: NaN, end: 9, text: 'new', expectedUpdatedAt: 2 }),
    ).toThrow('valid')
  })
})
