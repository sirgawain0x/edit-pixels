import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  TRANSCRIPTION_MAX_AUDIO_MINUTES,
  TRANSCRIPTION_RUN_CAP_USDC6,
  TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE,
  assertTranscriptionDurationAllowed,
  estimateTranscriptionCostUsdc6,
  formatUsdc6,
} from './pricing.mjs'

const quote = (minutes) => estimateTranscriptionCostUsdc6({ audioDurationSeconds: minutes * 60 })

describe('billing/pricing/transcription', () => {
  it('quotes the documented points', () => {
    assert.strictEqual(quote(0), 0)
    assert.strictEqual(quote(10), 75_000) // $0.075
    assert.strictEqual(quote(60), 450_000) // $0.45
    assert.strictEqual(quote(240), 1_800_000) // $1.80
    assert.strictEqual(formatUsdc6(quote(240)), '$1.8000')
  })

  it('binds the cap exactly at the 480-minute ceiling, never on a valid run', () => {
    // The cap is derived from the ceiling price, not chosen independently:
    // 480 min × 7,500 usdc6 == 3,600,000. Below the ceiling it must not bind.
    assert.strictEqual(
      TRANSCRIPTION_RUN_CAP_USDC6,
      TRANSCRIPTION_MAX_AUDIO_MINUTES * TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE,
    )
    assert.strictEqual(quote(TRANSCRIPTION_MAX_AUDIO_MINUTES), TRANSCRIPTION_RUN_CAP_USDC6)
    assert.strictEqual(quote(400), 400 * TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE)
    assert.ok(quote(400) < TRANSCRIPTION_RUN_CAP_USDC6)
    assert.strictEqual(quote(600), TRANSCRIPTION_RUN_CAP_USDC6)
  })

  it('holds at least 52% margin against measured Chirp batch COGS across the whole range', () => {
    const chirpBatchUsdc6PerMinute = 3_000 // $0.003/min
    for (const minutes of [1, 10, 60, 120, 240, 400, 480]) {
      const price = quote(minutes)
      const cogs = minutes * chirpBatchUsdc6PerMinute
      const margin = 1 - cogs / price
      assert.ok(margin >= 0.52, `${minutes} min margin ${(margin * 100).toFixed(1)}% below floor`)
    }
  })

  it('rejects runs past the product ceiling with a readable error', () => {
    assert.strictEqual(assertTranscriptionDurationAllowed(480 * 60), true)
    assert.throws(() => assertTranscriptionDurationAllowed(481 * 60), RangeError)
    assert.throws(() => assertTranscriptionDurationAllowed(481 * 60), /481\.0 minutes/)
  })

  it('never quotes a negative or NaN amount', () => {
    assert.strictEqual(estimateTranscriptionCostUsdc6({ audioDurationSeconds: -5 }), 0)
    assert.strictEqual(estimateTranscriptionCostUsdc6({ audioDurationSeconds: Number.NaN }), 0)
    assert.strictEqual(estimateTranscriptionCostUsdc6({}), 0)
  })
})
