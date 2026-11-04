import { describe, expect, it } from 'vite-plus/test'
import type { MediaTranscript } from '@/types/storage'
import {
  applyTranscriptCorrections,
  correctTranscriptWords,
  wordIsInSelectedInterval,
} from './transcript-corrections'

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

function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && aEnd > bStart
}

describe('wordIsInSelectedInterval', () => {
  it('does not select a neighbor that only shares a Whisper boundary overlap', () => {
    const first = { text: 'hello', start: 0, end: 0.5 }
    const second = { text: 'world', start: 0.48, end: 0.9 }

    expect(intervalsOverlap(first.start, first.end, 0, 0.5)).toBe(true)
    expect(intervalsOverlap(second.start, second.end, 0, 0.5)).toBe(true)

    expect(wordIsInSelectedInterval(first, 0, 0.5)).toBe(true)
    expect(wordIsInSelectedInterval(second, 0, 0.5)).toBe(false)
  })

  it('selects a word whose end extends slightly past the selection when its midpoint stays inside', () => {
    const selectionStart = 1.2
    const selectionEnd = 1.52
    const slackSeconds = 0.025
    const edited = { text: 'wrong', start: 1.2, end: selectionEnd + slackSeconds - 0.002 }

    expect(edited.end).toBeGreaterThan(selectionEnd)
    expect(edited.end - selectionEnd).toBeLessThanOrEqual(slackSeconds)
    expect(wordIsInSelectedInterval(edited, selectionStart, selectionEnd)).toBe(true)
  })

  it('does not select a neighbor whose midpoint is outside even when bounds overlap within slack', () => {
    const selectionStart = 1.2
    const selectionEnd = 1.52
    const neighbor = { text: 'very', start: 0.98, end: 1.225 }

    expect(intervalsOverlap(neighbor.start, neighbor.end, selectionStart, selectionEnd)).toBe(true)
    expect(wordIsInSelectedInterval(neighbor, selectionStart, selectionEnd)).toBe(false)
  })
})

const whisperVeryWrongOverlap: MediaTranscript = {
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

const whisperBoundaryOverlap: MediaTranscript = {
  ...transcript,
  text: 'hello world',
  segments: [
    {
      start: 0,
      end: 0.9,
      text: 'hello world',
      words: [
        { text: 'hello', start: 0, end: 0.5 },
        { text: 'world', start: 0.48, end: 0.9 },
      ],
    },
  ],
}

function expectBoundaryNeighborSurvives(updated: MediaTranscript) {
  expect(updated.text).toBe('hi world')
  expect(updated.segments.flatMap((segment) => segment.words ?? [])).toEqual([
    { text: 'hi', start: 0, end: 0.5, edited: true },
    { text: 'world', start: 0.48, end: 0.9 },
  ])
}

describe('transcript corrections', () => {
  it('replaces only midpoint-selected words when Whisper timings overlap at boundaries', () => {
    const updated = correctTranscriptWords(whisperBoundaryOverlap, {
      start: 0,
      end: 0.5,
      text: 'hi',
      expectedUpdatedAt: 2,
    })
    expectBoundaryNeighborSurvives(updated)
  })

  it('honors explicit dialog indices over overlapping selection timestamps', () => {
    const updated = correctTranscriptWords(whisperBoundaryOverlap, {
      start: 0,
      end: 0.9,
      indices: [0],
      text: 'hi',
      expectedUpdatedAt: 2,
    })
    expectBoundaryNeighborSurvives(updated)
  })

  it('does not replace neighboring whisper-overlap words when correcting one token', () => {
    const updated = correctTranscriptWords(whisperVeryWrongOverlap, {
      start: 1.2,
      end: 1.52,
      text: 'beautiful',
      expectedUpdatedAt: 2,
    })
    expect(updated.text).toBe('Hello very beautiful world')
    expect(updated.overrides?.[0]).toMatchObject({ start: 1.2, end: 1.52, timing: 'preserved' })
  })

  it('honors explicit dialog indices when very and wrong whisper timings overlap', () => {
    const updated = correctTranscriptWords(whisperVeryWrongOverlap, {
      start: 0.98,
      end: 1.52,
      indices: [2],
      text: 'beautiful',
      expectedUpdatedAt: 2,
    })
    expect(updated.text).toBe('Hello very beautiful world')
    expect(updated.overrides?.[0]).toMatchObject({ start: 1.2, end: 1.52, timing: 'preserved' })
  })

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

  it('keeps earlier boundary-neighbor overrides when correcting the next word', () => {
    const correctedHello = correctTranscriptWords(whisperBoundaryOverlap, {
      start: 0,
      end: 0.5,
      text: 'hi',
      expectedUpdatedAt: 2,
    })
    const correctedBoth = correctTranscriptWords(correctedHello, {
      start: 0.48,
      end: 0.9,
      text: 'earth',
      expectedUpdatedAt: correctedHello.updatedAt,
    })

    expect(correctedBoth.overrides?.map((override) => override.text).sort()).toEqual(['earth', 'hi'])
    expect(correctedBoth.text).toBe('hi earth')

    const regenerated = [
      {
        start: 0,
        end: 0.9,
        text: 'hello world',
        words: [
          { text: 'hello', start: 0, end: 0.5 },
          { text: 'world', start: 0.48, end: 0.9 },
        ],
      },
    ]
    expect(
      applyTranscriptCorrections(regenerated, correctedBoth.overrides!)
        .map((segment) => segment.text)
        .join(' '),
    ).toBe('hi earth')
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
