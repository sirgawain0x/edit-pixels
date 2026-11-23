import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  TRANSCRIPTION_MAX_AUDIO_MINUTES,
  TRANSCRIPTION_RUN_CAP_USDC6,
  TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE,
} from './lib/billing/pricing.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const apiPricingSource = readFileSync(
  join(here, '..', 'api', '_transcription-pricing.ts'),
  'utf8',
)

const extractLiteral = (source, name) => {
  const pattern = `export const ${name} = ([\\d_]+)`
  const match = new RegExp(pattern).exec(source)
  if (!match) throw new Error(`Missing literal ${name} in api/_transcription-pricing.ts`)
  return Number(match[1].replace(/_/g, ''))
}

describe('transcription pricing parity', () => {
  it('api/_transcription-pricing.ts matches headless/lib/billing/pricing.mjs', () => {
    const apiPerMinute = extractLiteral(apiPricingSource, 'TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE')
    const apiCap = extractLiteral(apiPricingSource, 'TRANSCRIPTION_RUN_CAP_USDC6')
    const apiMaxMinutes = extractLiteral(apiPricingSource, 'TRANSCRIPTION_MAX_AUDIO_MINUTES')

    assert.strictEqual(apiPerMinute, TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE)
    assert.strictEqual(apiCap, TRANSCRIPTION_RUN_CAP_USDC6)
    assert.strictEqual(apiMaxMinutes, TRANSCRIPTION_MAX_AUDIO_MINUTES)
  })

  it('cap equals the 480-minute ceiling price and binds only there', () => {
    assert.strictEqual(
      TRANSCRIPTION_RUN_CAP_USDC6,
      TRANSCRIPTION_MAX_AUDIO_MINUTES * TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE,
    )
  })
})
