import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import {
  estimateRenderCostUsdc6,
  estimateEditCostUsdc6,
  estimateDirectorCostUsdc6,
  metokenWeiToUsdc6,
  formatUsdc6,
  INTERVAL_COST_PREMIUM_USDC6,
  INTERVAL_COST_RETAIL_USDC6,
  DIRECTOR_USDC6_PER_AUDIO_MINUTE,
} from '../headless/lib/billing/pricing.mjs'
import { CreditLedger } from '../headless/lib/billing/ledger.mjs'

describe('billing/pricing', () => {
  it('estimates a 60s retail medium render at ~$0.05', () => {
    const cost = estimateRenderCostUsdc6({ durationSeconds: 60 })
    assert.ok(cost > 0)
    assert.strictEqual(cost, Math.round((60 / 300) * INTERVAL_COST_RETAIL_USDC6))
  })

  it('applies quality and GPU density multipliers', () => {
    const base = estimateRenderCostUsdc6({ durationSeconds: 300 })
    const high = estimateRenderCostUsdc6({ durationSeconds: 300, quality: 'high' })
    const highHeavy = estimateRenderCostUsdc6({
      durationSeconds: 300,
      quality: 'high',
      gpuDensity: 'heavy',
    })
    assert.ok(high > base)
    assert.ok(highHeavy > high)
  })

  it('audio-only render is cheaper', () => {
    const video = estimateRenderCostUsdc6({ durationSeconds: 300 })
    const audio = estimateRenderCostUsdc6({ durationSeconds: 300, audioOnly: true })
    assert.ok(audio < video)
  })

  it('premium interval halves the cost', () => {
    const retail = estimateRenderCostUsdc6({
      durationSeconds: 300,
      intervalCostUsdc6: INTERVAL_COST_RETAIL_USDC6,
    })
    const premium = estimateRenderCostUsdc6({
      durationSeconds: 300,
      intervalCostUsdc6: INTERVAL_COST_PREMIUM_USDC6,
    })
    assert.strictEqual(premium * 2, retail)
  })

  it('estimates edit cost flat per op', () => {
    const one = estimateEditCostUsdc6({ opCount: 1, intervalCostUsdc6: INTERVAL_COST_RETAIL_USDC6 })
    const five = estimateEditCostUsdc6({
      opCount: 5,
      intervalCostUsdc6: INTERVAL_COST_RETAIL_USDC6,
    })
    assert.strictEqual(five, one * 5)
  })

  it('formats usdc6 as USD string', () => {
    assert.strictEqual(formatUsdc6(1_250_000), '$1.2500')
    assert.strictEqual(formatUsdc6(125_000), '$0.1250')
  })

  it('converts metoken wei to usdc6', () => {
    // 1e18 metoken wei at price 1e12 = 1 usdc6
    const usdc6 = metokenWeiToUsdc6(10n ** 18n, 10n ** 12n)
    assert.strictEqual(usdc6, 1)
  })

  it('estimates Director cost prorated by timeline audio seconds', () => {
    assert.strictEqual(DIRECTOR_USDC6_PER_AUDIO_MINUTE, INTERVAL_COST_RETAIL_USDC6 / 5)
    assert.strictEqual(estimateDirectorCostUsdc6({ audioDurationSeconds: 0 }), 0)
    assert.strictEqual(
      estimateDirectorCostUsdc6({ audioDurationSeconds: 30 }),
      Math.round((30 * DIRECTOR_USDC6_PER_AUDIO_MINUTE) / 60),
    )
    assert.strictEqual(
      estimateDirectorCostUsdc6({ audioDurationSeconds: 250 }),
      Math.round((250 * DIRECTOR_USDC6_PER_AUDIO_MINUTE) / 60),
    )
    assert.notStrictEqual(
      estimateDirectorCostUsdc6({ audioDurationSeconds: 250 }),
      DIRECTOR_USDC6_PER_AUDIO_MINUTE * 5,
    )
  })
})

describe('billing/ledger', () => {
  let tmpDir
  let ledger

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixels-ledger-test-'))
    ledger = new CreditLedger({ storePath: path.join(tmpDir, 'ledger.json') })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('credits and debits an account', () => {
    ledger.credit('alice', 1_000_000)
    assert.strictEqual(ledger.getBalance('alice'), 1_000_000)
    const reserve = ledger.reserve('alice', 200_000)
    assert.strictEqual(reserve.ok, true)
    const settle = ledger.finalizeReservation('alice', reserve.reservationId, 150_000)
    assert.strictEqual(settle.chargedUsdc6, 150_000)
    assert.strictEqual(settle.returnedUsdc6, 50_000)
    assert.strictEqual(ledger.getBalance('alice'), 850_000)
  })

  it('blocks over-reservation', () => {
    ledger.credit('bob', 100_000)
    const reserve = ledger.reserve('bob', 200_000)
    assert.strictEqual(reserve.ok, false)
  })

  it('available balance excludes reservations', () => {
    ledger.credit('carol', 500_000)
    ledger.reserve('carol', 100_000)
    assert.strictEqual(ledger.availableBalance('carol'), 400_000)
    assert.strictEqual(ledger.getBalance('carol'), 500_000)
  })

  it('releases reservations without charging', () => {
    ledger.credit('dave', 500_000)
    const reserve = ledger.reserve('dave', 100_000)
    ledger.releaseReservation('dave', reserve.reservationId)
    assert.strictEqual(ledger.availableBalance('dave'), 500_000)
  })

  it('charges full actual when actual exceeds estimate', () => {
    ledger.credit('eve', 1_000_000)
    const reserve = ledger.reserve('eve', 200_000)
    assert.strictEqual(reserve.ok, true)
    const settle = ledger.finalizeReservation('eve', reserve.reservationId, 350_000)
    assert.strictEqual(settle.chargedUsdc6, 350_000)
    assert.strictEqual(settle.returnedUsdc6, 0)
    assert.strictEqual(ledger.getBalance('eve'), 650_000)
  })

  it('detects duplicate deposit transaction hashes', () => {
    ledger.credit('frank', 100_000, { txHash: '0xabc123' })
    assert.strictEqual(ledger.hasDepositTx('0xABC123'), true)
    assert.strictEqual(ledger.hasDepositTx('0xdef456'), false)
  })
})
