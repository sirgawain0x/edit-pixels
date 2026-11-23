import { describe, expect, it } from 'vitest'
import { mergePartTranscripts, type CloudPartTranscript } from './merge-part-transcripts'

function part(input: {
  index: number
  startSec: number
  endSec: number
  overlapSec?: number
  segments: Array<{
    speakerLabel?: string | null
    words: Array<[text: string, start: number | null, end: number | null]>
  }>
}): CloudPartTranscript {
  return {
    index: input.index,
    startSec: input.startSec,
    endSec: input.endSec,
    overlapSec: input.overlapSec ?? 0,
    segments: input.segments.map((segment) => ({
      speakerLabel: segment.speakerLabel ?? null,
      text: segment.words.map(([text]) => text).join(' '),
      words: segment.words.map(([word, startSeconds, endSeconds]) => ({
        word,
        startSeconds,
        endSeconds,
      })),
    })),
  }
}

describe('mergePartTranscripts', () => {
  it('makes offsets absolute against the part start', () => {
    const merged = mergePartTranscripts([
      part({
        index: 1,
        startSec: 100,
        endSec: 200,
        segments: [
          {
            words: [
              ['hello', 0.5, 1.0],
              ['world', 1.0, 1.5],
            ],
          },
        ],
      }),
    ])

    expect(merged.words.map((word) => [word.text, word.start, word.end])).toEqual([
      ['hello', 100.5, 101],
      ['world', 101, 101.5],
    ])
    expect(merged.segments[0]).toMatchObject({ start: 100.5, end: 101.5 })
  })

  it('drops the words the overlap repeats, from the later part', () => {
    // Part 0 ends at 100 with a 2 s overlap; part 1 starts at 98 and repeats bravo/charlie.
    const merged = mergePartTranscripts([
      part({
        index: 0,
        startSec: 0,
        endSec: 100,
        overlapSec: 2,
        segments: [
          {
            words: [
              ['alpha', 96, 98],
              ['bravo', 98, 99],
              ['charlie', 99, 100],
            ],
          },
        ],
      }),
      part({
        index: 1,
        startSec: 98,
        endSec: 200,
        segments: [
          {
            // Relative to part start: 0-1 -> 98-99, 1-2 -> 99-100, 2-3 -> 100-101.
            words: [
              ['bravo', 0, 1],
              ['charlie', 1, 2],
              ['delta', 2, 3],
            ],
          },
        ],
      }),
    ])

    expect(merged.words.map((word) => word.text)).toEqual(['alpha', 'bravo', 'charlie', 'delta'])
    expect(merged.text).toBe('alpha bravo charlie delta')
    expect(merged.emptyPartIndexes).toEqual([])
  })

  it('keeps a genuine repetition later in the recording', () => {
    // "no, no" is real speech: far from the boundary it must survive.
    const merged = mergePartTranscripts([
      part({
        index: 0,
        startSec: 0,
        endSec: 100,
        overlapSec: 2,
        segments: [
          {
            words: [
              ['no', 10, 10.3],
              ['no', 10.35, 10.6],
            ],
          },
        ],
      }),
    ])

    expect(merged.words.map((word) => word.text)).toEqual(['no', 'no'])
  })

  it('repairs a word missing its offsets and marks the timing as estimated', () => {
    const merged = mergePartTranscripts([
      part({
        index: 0,
        startSec: 50,
        endSec: 60,
        segments: [
          {
            words: [
              // The model omits the first word's offsets on some streams.
              ['first', null, null],
              ['second', 0.5, 0.8],
            ],
          },
        ],
      }),
    ])

    const [first, second] = merged.words
    expect(first).toMatchObject({ text: 'first', timing: 'estimated' })
    // Borrows the part start, then runs up to the next word's start.
    expect(first!.start).toBe(50)
    expect(first!.end).toBe(50.5)
    // A measured word carries no estimated marker.
    expect(second).toMatchObject({ text: 'second', start: 50.5, end: 50.8 })
    expect(second!.timing).toBeUndefined()
  })

  it('carries speaker labels onto the merged segments', () => {
    const merged = mergePartTranscripts([
      part({
        index: 0,
        startSec: 0,
        endSec: 60,
        segments: [
          { speakerLabel: 'spk:0', words: [['one', 0, 1]] },
          { speakerLabel: 'spk:1', words: [['two', 1, 2]] },
        ],
      }),
    ])

    expect(merged.segments.map((segment) => segment.speaker)).toEqual(['spk:0', 'spk:1'])
  })

  it('omits the speaker field when diarization was off', () => {
    const merged = mergePartTranscripts([
      part({ index: 0, startSec: 0, endSec: 10, segments: [{ words: [['one', 0, 1]] }] }),
    ])

    expect(merged.segments[0]).not.toHaveProperty('speaker')
  })

  it('reports a part that produced nothing instead of hiding the hole', () => {
    const merged = mergePartTranscripts([
      part({ index: 0, startSec: 0, endSec: 100, segments: [{ words: [['alpha', 0, 1]] }] }),
      part({ index: 1, startSec: 100, endSec: 200, segments: [] }),
      part({ index: 2, startSec: 200, endSec: 300, segments: [{ words: [['omega', 0, 1]] }] }),
    ])

    expect(merged.emptyPartIndexes).toEqual([1])
    expect(merged.words.map((word) => word.text)).toEqual(['alpha', 'omega'])
  })

  it('merges in index order regardless of arrival order', () => {
    const merged = mergePartTranscripts([
      part({ index: 1, startSec: 10, endSec: 20, segments: [{ words: [['second', 0, 1]] }] }),
      part({ index: 0, startSec: 0, endSec: 10, segments: [{ words: [['first', 0, 1]] }] }),
    ])

    expect(merged.words.map((word) => word.text)).toEqual(['first', 'second'])
  })

  it('returns an empty transcript for no parts', () => {
    expect(mergePartTranscripts([])).toEqual({
      text: '',
      segments: [],
      words: [],
      emptyPartIndexes: [],
    })
  })
})
