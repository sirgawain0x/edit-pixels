import { describe, expect, it, vi } from 'vitest'
import {
  getPrecisionPayment,
  hasPrecisionPayment,
  registerPrecisionPayment,
} from './precision-payment'
import type { PrecisionQuote } from './run-precision-job'

const QUOTE: PrecisionQuote = {
  jobId: 'job-1',
  free: false,
  priceUsd: 0.297,
  minCrtvaiWei: '2970000000000000',
}

describe('precision payment registry', () => {
  it('throws a named error when no wallet has registered', () => {
    expect(hasPrecisionPayment()).toBe(false)
    // The message has to say what is missing, because this fires deep inside a run.
    expect(() => getPrecisionPayment()).toThrow(/not registered/)
  })

  it('returns the registered payer', async () => {
    const pay = vi.fn(async () => '0xfeed')
    registerPrecisionPayment(pay)

    await expect(getPrecisionPayment()(QUOTE)).resolves.toBe('0xfeed')
    expect(pay).toHaveBeenCalledWith(QUOTE)
  })

  it('clears the slot when the registrar unmounts', () => {
    const unregister = registerPrecisionPayment(vi.fn(async () => '0xfeed'))
    expect(hasPrecisionPayment()).toBe(true)

    unregister()
    expect(hasPrecisionPayment()).toBe(false)
  })

  it('does not let a stale unmount clear a newer registration', () => {
    const first = registerPrecisionPayment(vi.fn(async () => '0x1'))
    const second = registerPrecisionPayment(vi.fn(async () => '0x2'))

    // The first bridge unmounts after a second one mounted: clearing would leave no payer.
    first()
    expect(hasPrecisionPayment()).toBe(true)
    second()
    expect(hasPrecisionPayment()).toBe(false)
  })
})
