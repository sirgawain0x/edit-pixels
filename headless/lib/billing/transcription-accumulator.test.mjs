import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  BILLING_GRANULARITY_SECONDS,
  CHIRP3_BATCH_RATE_USDC6_PER_SEC,
  TRANSCRIPTION_ABORT_BUFFER,
  TRANSCRIPTION_RATE_USDC6_PER_SEC,
  billedSeconds,
  chunkCostUsdc6,
  createTranscriptionAccumulator,
  glossaryHashOf,
  glossaryOverlayCacheKey,
  isSnapGridCompatible,
  normalizeGlossaryTerms,
  reconcileBilledSeconds,
  settleUsdc6,
  summarizeSubmittedAudio,
  transcriptCacheKey,
  transcriptionAbortHeadroom,
} from './transcription-accumulator.mjs'
import {
  TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE,
  estimateTranscriptionCostUsdc6,
} from './pricing.mjs'

const RATE = TRANSCRIPTION_RATE_USDC6_PER_SEC
const GRID_SECONDS = 600 // planner snaps non-final chunks to 10 minutes
const BAND_4H_USDC6 = 1_250_000 // $1.25
const BAND_8H_USDC6 = 2_450_000 // $2.45

/** Deterministic "random": exactly `count` failures spread across `parts`. */
function failureIndexes(parts, failureRate) {
  const count = Math.round(parts * failureRate)
  const step = Math.max(1, Math.floor(parts / Math.max(1, count)))
  const out = []
  for (let i = 0; i < count; i += 1) out.push(i * step)
  return new Set(out)
}

describe('billing/transcription-accumulator', () => {
  it('does not abort a healthy 48-part job at the 1.15 buffer, even when the provider rounds to 60s', () => {
    const parts = 48 // 8 hours of grid-aligned chunks
    const failed = failureIndexes(parts, 0.03)
    const granularity = BILLING_GRANULARITY_SECONDS['60s']
    const expected = parts * GRID_SECONDS * RATE

    const acc = createTranscriptionAccumulator({
      expectedUsdc6: expected,
      granularitySeconds: granularity,
      parts,
    })

    let stopped = false
    for (let index = 0; index < parts; index += 1) {
      const reported = failed.has(index) ? null : GRID_SECONDS * RATE // grid-aligned: no rounding
      const result = acc.add({ index, sentSeconds: GRID_SECONDS, reportedUsdc6: reported })
      if (result.overBudget) {
        stopped = true
        break
      }
    }

    assert.strictEqual(stopped, false, 'must not abort on a healthy job')
    assert.strictEqual(acc.overBudget, false)
    // Grid-aligned chunks are exact multiples of the billing grid, so rounding
    // contributes nothing and the failure fallback lands on the same number.
    assert.strictEqual(acc.spentUsdc6, expected)
    assert.strictEqual(acc.limitUsdc6, Math.ceil(expected * transcriptionAbortHeadroom(parts)))
    assert.strictEqual(acc.chunks.filter((c) => c.source === 'estimated').length, failed.size)
  })

  it('scales headroom with part count instead of carrying one tuned constant', () => {
    // Exact-convolution p99 retry overhead, never under-shot for n in 2..192.
    assert.strictEqual(transcriptionAbortHeadroom(8).toFixed(3), '1.375')
    assert.strictEqual(transcriptionAbortHeadroom(24).toFixed(3), '1.208')
    assert.strictEqual(transcriptionAbortHeadroom(48).toFixed(3), '1.167')
    assert.strictEqual(transcriptionAbortHeadroom(96).toFixed(3), '1.135')

    // An 8-part job that needs three retried chunks (37.5%) survives a scaled
    // buffer and false-aborts under the old flat 1.15.
    const parts = 8
    const expected = parts * GRID_SECONDS * RATE
    const retries = 3
    const spent = (parts + retries) * GRID_SECONDS * RATE

    const scaled = createTranscriptionAccumulator({ expectedUsdc6: expected, parts })
    const flat = createTranscriptionAccumulator({ expectedUsdc6: expected, buffer: 1.15 })
    assert.strictEqual(scaled.limitUsdc6 >= spent, true, 'scaled buffer must cover 8 parts + 3 retries')
    assert.strictEqual(flat.limitUsdc6 < spent, true, 'flat 1.15 must be shown to under-cover')

    for (let i = 0; i < retries; i += 1) {
      scaled.add({ index: parts + i, sentSeconds: GRID_SECONDS, reportedUsdc6: GRID_SECONDS * RATE })
    }
    assert.strictEqual(scaled.overBudget, false)
  })

  it('bills a non-grid-aligned final chunk up to the grid on fallback', () => {
    const sent = 577 // 9:37, the realistic VAD partial
    const granularity = BILLING_GRANULARITY_SECONDS['60s']

    const accurate = chunkCostUsdc6({ sentSeconds: sent, granularitySeconds: granularity })
    const naive = chunkCostUsdc6({ sentSeconds: sent, granularitySeconds: 0 })

    assert.strictEqual(billedSeconds(sent, granularity), 600)
    assert.strictEqual(accurate.usdc6, 600 * RATE)
    assert.strictEqual(naive.usdc6, 577 * RATE)
    assert.strictEqual(accurate.source, 'estimated')
    // The whole reason `granularityFactor` exists: ignoring the grid
    // under-reports the chunk by ~4% of its cost, every single time.
    assert.ok(accurate.usdc6 > naive.usdc6)
    assert.strictEqual(accurate.usdc6 - naive.usdc6, 23 * RATE)
  })

  it('prefers reported usage.cost over audio-seconds arithmetic', () => {
    const reported = chunkCostUsdc6({ sentSeconds: 600, reportedUsdc6: 12_345 })
    assert.strictEqual(reported.source, 'reported')
    assert.strictEqual(reported.usdc6, 12_345)
    assert.notStrictEqual(reported.usdc6, 600 * RATE)
  })

  it('refuses a reported zero cost instead of booking the chunk as free', () => {
    // The adapter-mismatch failure: Vertex reports usageMetadata.*TokenCount,
    // Interactions reports usage.total_output_tokens. Miss the shape and you get
    // a zero, not a null — and a zero that is trusted settles the job at $0.
    const zero = chunkCostUsdc6({ sentSeconds: 600, reportedUsdc6: 0 })
    assert.strictEqual(zero.source, 'estimated')
    assert.strictEqual(zero.ignoredZeroReport, true)
    assert.strictEqual(zero.usdc6, 600 * RATE)

    const acc = createTranscriptionAccumulator({ expectedUsdc6: 4 * GRID_SECONDS * RATE, parts: 4 })
    for (let index = 0; index < 4; index += 1) {
      acc.add({ index, sentSeconds: GRID_SECONDS, reportedUsdc6: 0 })
    }
    assert.strictEqual(acc.zeroReports, 4)
    assert.strictEqual(acc.spentUsdc6, 4 * GRID_SECONDS * RATE)
    assert.notStrictEqual(acc.spentUsdc6, 0)
  })

  it('aborts at the chunk that blows the budget and refuses further chunks', () => {
    const parts = 24
    const expected = parts * GRID_SECONDS * RATE
    const acc = createTranscriptionAccumulator({ expectedUsdc6: expected, parts })

    let abortedAt = null
    for (let index = 0; index < parts; index += 1) {
      // Chunk 7 comes back repriced ~40x: the provider changed the rate.
      const reported = index === 7 ? GRID_SECONDS * RATE * 40 : GRID_SECONDS * RATE
      const result = acc.add({ index, sentSeconds: GRID_SECONDS, reportedUsdc6: reported })
      if (result.overBudget) {
        abortedAt = index
        break
      }
    }

    assert.strictEqual(abortedAt, 7)
    assert.strictEqual(acc.overBudget, true)
    const after = acc.add({ index: 8, sentSeconds: GRID_SECONDS, reportedUsdc6: GRID_SECONDS * RATE })
    assert.deepStrictEqual(after, {
      accepted: false,
      reason: 'already-aborted',
      spentUsdc6: acc.spentUsdc6,
      limitUsdc6: acc.limitUsdc6,
      index: 8,
    })
  })

  it('clamps settlement at the band price the user was shown', () => {
    const fine = settleUsdc6(245_000, BAND_4H_USDC6)
    assert.deepStrictEqual(fine, { usdc6: 245_000, clamped: false })

    const over = settleUsdc6(1_600_000, BAND_4H_USDC6)
    assert.deepStrictEqual(over, { usdc6: BAND_4H_USDC6, clamped: true })

    assert.strictEqual(settleUsdc6(490_000, BAND_8H_USDC6).usdc6, 490_000)
  })

  it('keeps the band margin at or above 75% under every billing granularity', () => {
    const bands = [
      { minutes: 60, price: 500_000 },
      { minutes: 120, price: 750_000 },
      { minutes: 240, price: BAND_4H_USDC6 },
    ]
    for (const [label, seconds] of Object.entries(BILLING_GRANULARITY_SECONDS)) {
      // Worst realistic case: every chunk is a 577s partial that rounds up.
      const parts = Math.ceil(240 / (577 / 60))
      let cogs = 0
      for (let i = 0; i < parts; i += 1) {
        cogs += chunkCostUsdc6({ sentSeconds: 577, granularitySeconds: seconds }).usdc6
      }
      const margin = 1 - cogs / BAND_4H_USDC6
      assert.ok(margin >= 0.55, `${label} granularity margin ${(margin * 100).toFixed(1)}% too thin`)
    }
    for (const band of bands) {
      const exact = band.minutes * 60 * RATE
      assert.ok(1 - exact / band.price >= 0.75, `${band.minutes}m band below 75%`)
    }
  })

  it('only accepts snap grids that are whole multiples of the billing grid', () => {
    for (const granularity of Object.values(BILLING_GRANULARITY_SECONDS)) {
      assert.strictEqual(isSnapGridCompatible(GRID_SECONDS, granularity), true, `grid 600 vs ${granularity}`)
    }
    assert.strictEqual(isSnapGridCompatible(GRID_SECONDS, 400), false)
    assert.strictEqual(isSnapGridCompatible(0, 60), false)
  })

  it('splits the cache so editing the glossary never re-bills a transcript', () => {
    const fileSha = 'a'.repeat(64)
    const base = { fileSha, modelId: 'nvidia/nemotron-3.5-transcribe', paramsVersion: '1' }

    const first = transcriptCacheKey(base)
    const withOneName = transcriptCacheKey(base) // same inputs, glossary is a local overlay
    assert.strictEqual(first, withOneName, 'transcript key must not carry the glossary')

    const glossaryA = glossaryHashOf(['Gawain', 'Lovelace'])
    const glossaryB = glossaryHashOf(['Gawain', 'Lovelace', 'Hopper'])
    assert.notStrictEqual(glossaryA, glossaryB)

    const overlayA = glossaryOverlayCacheKey({ transcriptKey: first, glossaryHash: glossaryA })
    const overlayB = glossaryOverlayCacheKey({ transcriptKey: first, glossaryHash: glossaryB })
    assert.notStrictEqual(overlayA, overlayB, 'a glossary edit must produce a new overlay, not a new transcript')
    assert.ok(overlayA.startsWith(`glo:v2:${first}:`))
  })

  it('invalidates the overlay when the matcher changes, without touching the transcript', () => {
    const transcriptKey = transcriptCacheKey({ fileSha: 'c'.repeat(64), modelId: 'chirp_3' })
    const glossaryHash = glossaryHashOf(['twenty six million dollars'])
    const v1 = glossaryOverlayCacheKey({ transcriptKey, glossaryHash, matcherVersion: '1' })
    const v2 = glossaryOverlayCacheKey({ transcriptKey, glossaryHash, matcherVersion: '2' })
    // A normalizer fix (e.g. currency/number handling for Google ITN output) has to
    // invalidate overlays, or cached overlays keep serving the old matcher's result.
    assert.notStrictEqual(v1, v2)
    assert.ok(v1.includes(':m1') && v2.includes(':m2'))
  })

  it('prices a Chirp 3 batch job at real billed rates and still settles under the cap', () => {
    const seconds = 480 * 60 // 8 hours, 24 sub-20-minute files
    const expected = seconds * CHIRP3_BATCH_RATE_USDC6_PER_SEC
    assert.strictEqual(expected, 1_440_000, '8h at $0.18/hr is $1.44')

    const acc = createTranscriptionAccumulator({
      expectedUsdc6: expected,
      rateUsdc6PerSec: CHIRP3_BATCH_RATE_USDC6_PER_SEC,
      parts: 24,
    })
    for (let index = 0; index < 24; index += 1) {
      acc.add({ index, sentSeconds: 20 * 60, reportedUsdc6: 20 * 60 * CHIRP3_BATCH_RATE_USDC6_PER_SEC })
    }
    assert.strictEqual(acc.spentUsdc6, expected)
    assert.strictEqual(acc.overBudget, false)
    // The $3.60 ceiling lets the whole run through unclamped.
    assert.deepStrictEqual(settleUsdc6(acc.spentUsdc6, 3_600_000), {
      usdc6: expected,
      clamped: false,
    })
  })

  it('separates the abort line from the margin alert, so short jobs stay retryable', () => {
    const seconds = 480 * 60
    const expected = seconds * CHIRP3_BATCH_RATE_USDC6_PER_SEC
    const quote = 3_600_000 // $3.60 at $0.0075/min over 8h
    const acc = createTranscriptionAccumulator({
      expectedUsdc6: expected,
      rateUsdc6PerSec: CHIRP3_BATCH_RATE_USDC6_PER_SEC,
      parts: 24,
      quoteUsdc6: quote,
      marginFloor: 0.5,
    })

    // Abort at 80% of the quote ($2.88), alert at 50% ($1.80). Finishing at a thin
    // margin always beats releasing: a release refunds revenue and keeps the COGS.
    assert.strictEqual(acc.limitSource, 'quote-abort-ratio')
    assert.strictEqual(acc.abortAtUsdc6 ?? acc.limitUsdc6, 2_880_000)
    assert.strictEqual(acc.alertAtUsdc6, 1_800_000)
    // 80% of the quote over a $1.44 base buys 24 sub-file retries at $0.06 each,
    // and the alert fires long before the abort line does.
    assert.strictEqual(acc.retryAllowance, 24)

    // A 60-minute job: the 50% floor would allow zero retries, but one rebuild at
    // $0.06 still leaves $0.09 gross, so the abort line must permit it.
    const short = createTranscriptionAccumulator({
      expectedUsdc6: 3 * 20 * 60 * CHIRP3_BATCH_RATE_USDC6_PER_SEC,
      rateUsdc6PerSec: CHIRP3_BATCH_RATE_USDC6_PER_SEC,
      parts: 3,
      quoteUsdc6: 450_000,
      marginFloor: 0.5,
    })
    assert.strictEqual(short.limitUsdc6, 360_000) // 80% of $0.45
    assert.strictEqual(short.alertAtUsdc6, 225_000) // 50% of $0.45
    assert.strictEqual(short.retryAllowance, 3)
    assert.strictEqual(short.overBudget, false)
  })

  it('normalizes glossary terms so ordering, case and whitespace cannot re-bill', () => {
    const a = glossaryHashOf(['  Gawain ', 'LOVELACE', 'gawain', ''])
    const b = glossaryHashOf(['lovelace', 'Gawain'])
    assert.strictEqual(a, b)
    assert.deepStrictEqual(normalizeGlossaryTerms(['  B ', 'a', 'A', '  ']), ['a', 'b'])
    assert.strictEqual(glossaryHashOf([]), null)
    assert.strictEqual(glossaryHashOf(undefined), null)
  })

  it('gives provider-side biasing its own transcript key', () => {
    const base = { fileSha: 'b'.repeat(64), modelId: 'nvidia/nemotron-3.5-transcribe' }
    const localOnly = transcriptCacheKey(base)
    const biased = transcriptCacheKey({ ...base, providerGlossaryHash: glossaryHashOf(['Gawain']) })
    assert.notStrictEqual(localOnly, biased, 'context sent to the provider changes the transcript')
    assert.ok(biased.includes(':pg'))
  })

  it('measures the quote and the 1200s wall on the same clock', () => {
    // Exactly 20:00 is accepted upstream; 20:01 is rejected and billed zero.
    const accepted = summarizeSubmittedAudio([1200, 1200, 1200])
    assert.deepStrictEqual(accepted.overLimit, [])
    assert.strictEqual(accepted.totalSeconds, 3600)
    assert.strictEqual(accepted.parts, 3)

    const rejected = summarizeSubmittedAudio([1200, 1201, 1132])
    assert.deepStrictEqual(rejected.overLimit, [1])

    // A 19:58 cut padded by 4s becomes 20:02 and is refused upstream — which is
    // why the plan must not pad. Unpadded, the same audio submits 1198s.
    assert.deepStrictEqual(summarizeSubmittedAudio([1198 + 4]).overLimit, [0])
    assert.deepStrictEqual(summarizeSubmittedAudio([1198]).overLimit, [])

    // Uneven silence-snapped cuts are normal; the total is what gets priced.
    const uneven = summarizeSubmittedAudio([1120, 1200, 1152, 1148])
    assert.strictEqual(uneven.totalMinutes, 77)
    assert.strictEqual(
      estimateTranscriptionCostUsdc6({ audioDurationSeconds: uneven.totalSeconds }),
      77 * TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE,
    )
  })

  it('reconciles measured billing against the quote, and never books a failed part at zero', () => {
    // Exact, from the measured samples: 4 identical files, 1140s each.
    assert.deepStrictEqual(
      reconcileBilledSeconds({
        submittedSecondsCeil: 4560,
        expectedSubmittedSeconds: 4560,
        measuredTotalSeconds: 4560,
        measuredPartSeconds: [1140, 1140, 1140, 1140],
      }),
      { verdict: 'exact', driftSeconds: 0, failedParts: [], identityOk: true },
    )

    // A part with null metadata is a failure, not a zero-cost delivery.
    assert.deepStrictEqual(
      reconcileBilledSeconds({
        submittedSecondsCeil: 2280,
        expectedSubmittedSeconds: 2280,
        measuredTotalSeconds: 1140,
        measuredPartSeconds: [1140, null],
      }),
      { verdict: 'failed-parts', driftSeconds: -1140, failedParts: [1], identityOk: true },
    )

    // Top-level 0s with submitted audio is a submit failure, never a free job.
    assert.strictEqual(
      reconcileBilledSeconds({
        submittedSecondsCeil: 3540,
        expectedSubmittedSeconds: 3540,
        measuredTotalSeconds: 0,
        measuredPartSeconds: [null],
      }).verdict,
      'submit-failure',
    )

    // Missing billing entirely is its own verdict; it must not read as $0.
    assert.strictEqual(
      reconcileBilledSeconds({ submittedSecondsCeil: 1200, measuredTotalSeconds: null }).verdict,
      'missing-billing',
    )

    // sum(parts) !== total catches a dropped or double-counted part.
    assert.strictEqual(
      reconcileBilledSeconds({
        submittedSecondsCeil: 4560,
        expectedSubmittedSeconds: 4560,
        measuredTotalSeconds: 4560,
        measuredPartSeconds: [1140, 1140, 1140],
      }).verdict,
      'integrity-mismatch',
    )

    // Positive drift is Opus preskip or a Google billing change; negative drift
    // means we planned the job wrong, because measured can only round up.
    assert.strictEqual(
      reconcileBilledSeconds({
        submittedSecondsCeil: 3600,
        expectedSubmittedSeconds: 3597,
        measuredTotalSeconds: 3603,
        measuredPartSeconds: [1200, 1200, 1203],
      }).verdict,
      'drift',
    )
  })
})
