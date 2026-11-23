import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseSeconds,
  reconcileOperation,
  sanitizePartWords,
  segmentsFromWords,
  speechSpanCoverage,
  stitchParts,
  type ChirpWordAnnotation,
  type ParsedWord,
} from './chirp-parse'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'))
const wordsOf = (name: string): ChirpWordAnnotation[] =>
  fixture(name).results[0].alternatives[0].words as ChirpWordAnnotation[]

/**
 * Tile a short fixture into a realistic-length sample so the gate's minimum-sample floor
 * does not (correctly) refuse to evaluate it. Density is preserved by construction.
 */
function tileWords(words: ChirpWordAnnotation[], totalSeconds: number): ParsedWord[] {
  const clipSeconds = 6.19
  const copies = Math.ceil(totalSeconds / clipSeconds)
  const out: ParsedWord[] = []
  for (let copy = 0; copy < copies; copy += 1) {
    for (const word of words) {
      out.push({
        text: word.word ?? '',
        start: copy * clipSeconds + (parseSeconds(word.startOffset) ?? 0),
        end: copy * clipSeconds + (parseSeconds(word.endOffset) ?? 0),
      })
    }
  }
  return out.filter((word) => word.start < totalSeconds)
}

describe('parseSeconds', () => {
  it('parses the seconds suffix, and absence is null not zero', () => {
    expect(parseSeconds('1140s')).toBe(1140)
    expect(parseSeconds('540.876s')).toBe(540.876)
    expect(parseSeconds(null)).toBeNull()
    expect(parseSeconds(undefined)).toBeNull()
    expect(parseSeconds('')).toBeNull()
    expect(parseSeconds(null)).not.toBe(0)
  })
})

describe('reconcileOperation', () => {
  it('4 healthy parts is exact and the sum identity holds', () => {
    const operation = fixture('poll4.json')
    const results = operation.response.results as Record<
      string,
      { metadata: { totalBilledDuration: string } }
    >
    const plannedParts = Object.keys(results).map((uri) => ({
      uri,
      startSec: 0,
      endSec: 0,
      estimateSeconds: parseSeconds(results[uri]?.metadata?.totalBilledDuration ?? null),
    }))

    const out = reconcileOperation({ operation, plannedParts })
    expect(out.verdict).toBe('exact')
    expect(out.deliveredParts).toBe(4)
    expect(out.jobLevelSeconds).toBe(4560)
    expect(out.measuredBilledSeconds).toBe(4560)
    expect(out.absentUris).toEqual([])
  })

  it('3 good + 1 over-limit is failed-parts, billed for the survivors only', () => {
    const operation = fixture('pollpartial.json')
    const results = operation.response.results as Record<
      string,
      { metadata?: { totalBilledDuration: string }; error?: { message: string } }
    >
    const plannedParts = Object.keys(results).map((uri) => ({
      uri,
      startSec: 0,
      endSec: 0,
      estimateSeconds: parseSeconds(results[uri]?.metadata?.totalBilledDuration ?? null),
    }))

    const out = reconcileOperation({ operation, plannedParts })
    expect(out.verdict).toBe('failed-parts')
    expect(out.jobLevelSeconds).toBe(2821)
    expect(out.measuredBilledSeconds).toBe(2821)
    expect(out.deliveredParts).toBe(3)
    const failed = out.parts.filter((part) => part.verdict !== 'exact')
    expect(failed.length).toBe(1)
    expect(failed[0]!.billedSecondsMeasured).toBeNull()
    expect(failed[0]!.errorMessage).toMatch(/20 minutes/)
  })

  it('a single rejected part bills 0 and still reports failed-parts, not submit-failure', () => {
    const operation = fixture('op_poll.json')
    const results = operation.response.results as Record<string, unknown>
    const plannedParts = Object.keys(results).map((uri) => ({
      uri,
      startSec: 0,
      endSec: 0,
      estimateSeconds: 1140,
    }))

    const out = reconcileOperation({ operation, plannedParts })
    expect(out.verdict).toBe('failed-parts')
    expect(out.jobLevelSeconds).toBe(0)
    expect(out.measuredBilledSeconds).toBe(0)
  })

  it('missing billing metadata is missing-billing, never a free job', () => {
    const out = reconcileOperation({
      operation: { response: { results: {} } },
      plannedParts: [],
    })
    expect(out.verdict).toBe('missing-billing')
    expect(out.jobLevelSeconds).toBeNull()
  })

  it('absent URI is integrity-mismatch even when the sum matches', () => {
    const operation = fixture('poll4.json')
    const results = operation.response.results as Record<string, unknown>
    const plannedParts = [
      ...Object.keys(results).map((uri) => ({
        uri,
        startSec: 0,
        endSec: 0,
        estimateSeconds: 1140,
      })),
      {
        uri: 'gs://bucket/never-returned.flac',
        startSec: 0,
        endSec: 0,
        estimateSeconds: 1140,
      },
    ]

    const out = reconcileOperation({ operation, plannedParts })
    expect(out.verdict).toBe('integrity-mismatch')
    expect(out.absentUris).toEqual(['gs://bucket/never-returned.flac'])
  })

  it('sum mismatch against the job total is integrity-mismatch', () => {
    const operation = {
      response: {
        totalBilledDuration: '9999s',
        results: fixture('poll4.json').response.results,
      },
    }
    const results = operation.response.results as Record<string, unknown>
    const plannedParts = Object.keys(results).map((uri) => ({
      uri,
      startSec: 0,
      endSec: 0,
      estimateSeconds: 1140,
    }))
    const out = reconcileOperation({ operation, plannedParts })
    expect(out.verdict).toBe('integrity-mismatch')
  })
})

describe('sanitizePartWords', () => {
  it('drops the real out-of-range and inverted spans found in the fixtures', () => {
    const words = wordsOf('out_1200.json')
    const rawMax = Math.max(...words.map((word) => parseSeconds(word.startOffset) ?? 0))
    expect(rawMax).toBeGreaterThan(1200)

    const out = sanitizePartWords({ words, partStartSec: 0, partDurationSec: 1200 })
    expect(out.dropped).toBeGreaterThanOrEqual(1)
    expect(out.words.every((word) => word.end <= 1200.5)).toBe(true)
    expect(out.words.every((word) => word.end > word.start)).toBe(true)
    expect(
      out.words.every((word, index) => index === 0 || word.start >= out.words[index - 1]!.start),
    ).toBe(true)
  })

  it('absolute times are part-relative plus the part start', () => {
    const words = wordsOf('out_prose.json').slice(0, 5)
    const firstStartOffset = parseSeconds(words[0]?.startOffset ?? null) ?? 0
    const out = sanitizePartWords({ words, partStartSec: 1200, partDurationSec: 1200 })
    expect(out.dropped).toBe(0)
    expect(Math.abs(out.words[0]!.start - (1200 + firstStartOffset))).toBeLessThan(1e-9)
  })
})

describe('speechSpanCoverage', () => {
  it('healthy prose is healthy against its VAD speech seconds', () => {
    const words = sanitizePartWords({
      words: wordsOf('out_prose.json'),
      partStartSec: 0,
      partDurationSec: 541,
    }).words
    const out = speechSpanCoverage({ words, vadSpeechSeconds: 541 })
    expect(out.verdict).toBe('healthy')
    expect(out.tokensPerSpeechSecond).toBeGreaterThan(2.3)
  })

  it('trailing silence must not make healthy speech look truncated', () => {
    const words = sanitizePartWords({
      words: wordsOf('out_1200.json'),
      partStartSec: 0,
      partDurationSec: 1200,
    }).words
    // 1413 words over 1200s of FILE is 1.18/s -> would false-trigger; over 541s of VAD speech it is healthy.
    const out = speechSpanCoverage({ words, vadSpeechSeconds: 541 })
    expect(out.verdict).toBe('healthy')
  })

  it('ITN-dense numbers land in suspect, never truncated (retry policy boundary)', () => {
    // 6.19s clip spoken as 17 words, returned as 9 tokens because ITN collapsed them.
    // Tiled to 5 minutes: the real clip is below the gate's minimum sample size.
    const words = tileWords(wordsOf('itn_dense.json'), 300)
    const out = speechSpanCoverage({ words, vadSpeechSeconds: 291, partDurationSec: 300 })
    expect(out.verdict).toBe('suspect')
    expect(out.tokensPerSpeechSecond).toBeGreaterThan(1.4)
    expect(out.tokensPerSpeechSecond).toBeLessThan(1.8)
  })

  it('thresholds classify identically on VAD seconds and on file duration', () => {
    const cases = [
      { file: 'out_prose.json', duration: 541, vad: 469.4, expected: 'healthy' as const },
      { file: 'out19b.json', duration: 1140, vad: 1021.4, expected: 'healthy' as const },
      { file: 'out19.json', duration: 1140, vad: 1021.4, expected: 'truncated' as const },
    ]
    for (const item of cases) {
      const words = sanitizePartWords({
        words: wordsOf(item.file),
        partStartSec: 0,
        partDurationSec: item.duration,
      }).words
      expect(
        speechSpanCoverage({ words, vadSpeechSeconds: item.vad }).verdict,
        `${item.file} (vad)`,
      ).toBe(item.expected)
      expect(
        speechSpanCoverage({ words, vadSpeechSeconds: item.duration }).verdict,
        `${item.file} (file)`,
      ).toBe(item.expected)
    }
  })

  it('stretched-timestamp truncation is caught by token rate, not by coverage', () => {
    const words = sanitizePartWords({
      words: wordsOf('out19.json'),
      partStartSec: 0,
      partDurationSec: 1140,
    }).words
    const out = speechSpanCoverage({ words, vadSpeechSeconds: 1140 })
    expect(out.verdict).toBe('truncated')
    expect(out.tokensPerSpeechSecond).toBeLessThan(1.4)
    // The point of the test: coverage alone would have PASSED this file.
    expect(out.coverage).toBeGreaterThan(0.85)
  })

  it('2x2: under-detected VAD delivers, no-silence VAD retries', () => {
    const truncWords = sanitizePartWords({
      words: wordsOf('out19.json'),
      partStartSec: 0,
      partDurationSec: 1140,
    }).words

    // (a) VAD caught only 150s of a 1140s part: >4.5 tokens/s -> deliver + flag
    const underDetected = speechSpanCoverage({
      words: truncWords,
      vadSpeechSeconds: 150,
      partDurationSec: 1140,
    })
    expect(underDetected.verdict).toBe('vad-uncertain')
    expect(underDetected.flag).toBe('under-detected')
    expect(underDetected.tokensPerSpeechSecond).toBeGreaterThan(4.5)

    // (b) VAD says wall-to-wall speech AND the token rate is low -> genuine truncation, retry
    const noSilenceTruncated = speechSpanCoverage({
      words: truncWords,
      vadSpeechSeconds: 1140,
      partDurationSec: 1140,
    })
    expect(noSilenceTruncated.verdict).toBe('truncated')
    expect(noSilenceTruncated.flag).toBe('no-silence')

    // (c) VAD says wall-to-wall speech but the token rate is healthy -> impossible, undecidable
    const proseWords = wordsOf('out_prose.json').map((w) => ({
      text: w.word ?? '',
      start: parseSeconds(w.startOffset) ?? 0,
      end: parseSeconds(w.endOffset) ?? 0,
    }))
    const noSilenceHealthy = speechSpanCoverage({
      words: proseWords,
      vadSpeechSeconds: 500,
      partDurationSec: 500,
    })
    expect(noSilenceHealthy.verdict).toBe('vad-uncertain')
    expect(noSilenceHealthy.flag).toBe('no-silence')

    // (d) normal audio: no flag, verdict from the token rate alone
    const normal = speechSpanCoverage({
      words: truncWords,
      vadSpeechSeconds: 1021.4,
      partDurationSec: 1140,
    })
    expect(normal.verdict).toBe('truncated')
    expect(normal.flag).toBeNull()
  })

  it('the real 6-second ITN clip is not-evaluated (floor pinning)', () => {
    // Keep the motivating fixture pinned at the floor's behaviour, not only at the tiled
    // version: this is the clip whose density motivated the suspect band.
    const words = sanitizePartWords({
      words: wordsOf('itn_dense.json'),
      partStartSec: 0,
      partDurationSec: 6.19,
    }).words
    expect(words.length).toBe(9)
    const out = speechSpanCoverage({ words, vadSpeechSeconds: 5.84, partDurationSec: 6.19 })
    expect(out.verdict).toBe('not-evaluated')
    expect(out.reason).toBe('sample-too-small')
  })

  it('forcedCut suppresses the flag but never changes the verdict', () => {
    const healthy = sanitizePartWords({
      words: wordsOf('out_prose.json'),
      partStartSec: 0,
      partDurationSec: 541,
    }).words
    const truncated = sanitizePartWords({
      words: wordsOf('out19.json'),
      partStartSec: 0,
      partDurationSec: 1140,
    }).words

    // healthy rate (1414 words / 469.4s = 3.01 tokens/s) + 100% speech + forced cut
    const forcedHealthy = speechSpanCoverage({
      words: healthy,
      vadSpeechSeconds: 469.4,
      partDurationSec: 469.4,
      forcedCut: true,
    })
    expect(forcedHealthy.verdict).toBe('healthy')
    expect(forcedHealthy.flag).toBeNull()
    expect(forcedHealthy.suppressedFlag).toBe('no-silence')

    // forced cut does NOT excuse a genuine truncation
    const forcedTruncated = speechSpanCoverage({
      words: truncated,
      vadSpeechSeconds: 1140,
      partDurationSec: 1140,
      forcedCut: true,
    })
    expect(forcedTruncated.verdict).toBe('truncated')
    expect(forcedTruncated.flag).toBeNull()
    expect(forcedTruncated.suppressedFlag).toBe('no-silence')

    // same audio without forcedCut: the flag is real, not suppressed
    const unforced = speechSpanCoverage({
      words: truncated,
      vadSpeechSeconds: 1140,
      partDurationSec: 1140,
    })
    expect(unforced.flag).toBe('no-silence')
    expect(unforced.suppressedFlag).toBeUndefined()
  })

  it('short parts are not-evaluated rather than guessed', () => {
    // ~25 tokens on a 10s part has a ~20% 1-sigma spread: wider than the whole verdict band.
    const words = sanitizePartWords({
      words: wordsOf('itn_dense.json'),
      partStartSec: 0,
      partDurationSec: 6.19,
    }).words
    const short = speechSpanCoverage({ words, vadSpeechSeconds: 10, partDurationSec: 12 })
    expect(short.verdict).toBe('not-evaluated')
    expect(short.evaluated).toBe(false)
    expect(short.reason).toBe('sample-too-small')
  })

  it('the seam overlap cancels out of the ratio (no denominator netting needed)', () => {
    const words = sanitizePartWords({
      words: wordsOf('out19b.json'),
      partStartSec: 0,
      partDurationSec: 1140,
    }).words
    const rate = words.length / 1021.4
    // 2.0s of duplicated audio: both the token count and the speech seconds grow by the same
    // proportion, so the ratio is unchanged.
    const duplicatedWords = 8
    const withOverlap = (words.length + duplicatedWords) / (1021.4 + 2.0)
    expect(Math.abs(withOverlap - rate) / rate).toBeLessThan(0.005)
  })
})

describe('stitchParts', () => {
  it('seam overlap produces no duplicate words and no gap over overlap/2', () => {
    const partA = sanitizePartWords({
      words: [
        { startOffset: '0.0s', endOffset: '0.5s', word: 'alpha' },
        { startOffset: '1.0s', endOffset: '1.5s', word: 'bravo' },
        { startOffset: '1.6s', endOffset: '1.9s', word: 'seam' },
      ],
      partStartSec: 0,
      partDurationSec: 2,
    }).words
    const partB = sanitizePartWords({
      words: [
        { startOffset: '0.0s', endOffset: '0.3s', word: 'seam' },
        { startOffset: '0.4s', endOffset: '0.9s', word: 'charlie' },
      ],
      partStartSec: 1.7,
      partDurationSec: 2,
    }).words

    const { words, seams } = stitchParts({
      parts: [
        { startSec: 0, endSec: 2, words: partA },
        { startSec: 1.7, endSec: 3.7, words: partB },
      ],
      overlapSec: 0.3,
    })

    const texts = words.map((word) => word.text)
    expect(texts.filter((text) => text === 'seam').length).toBe(1)
    expect(texts).toEqual(['alpha', 'bravo', 'seam', 'charlie'])
    expect(seams.length).toBe(1)

    for (let index = 1; index < words.length; index += 1) {
      expect(words[index]!.start - words[index - 1]!.end).toBeLessThan(0.6)
    }
  })
})

describe('segmentsFromWords', () => {
  it('breaks on speaker change, pause, and max length', () => {
    const words = [
      { text: 'one', start: 0, end: 0.4, speaker: '0' },
      { text: 'two', start: 0.4, end: 0.8, speaker: '0' },
      { text: 'three', start: 2.0, end: 2.4, speaker: '0' },
      { text: 'four', start: 2.4, end: 2.8, speaker: '1' },
    ]
    const segments = segmentsFromWords({ words })
    expect(segments.length).toBe(3)
    expect(segments[0]!.text).toBe('one two')
    expect(segments[1]!.text).toBe('three')
    expect(segments[2]!.speaker).toBe('1')
  })
})
