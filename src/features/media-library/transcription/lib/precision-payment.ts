/**
 * Where a Precision run gets its payment from.
 *
 * The runner cannot take the wallet as a parameter: four different callers start a
 * transcription and three of them are plain utility modules (silence removal, filler-word
 * removal) with no React and no wallet in scope. A module-level slot registered once by a
 * hook reaches all of them, and the same shape already exists one directory over for the
 * media library service loader.
 *
 * The getter throws rather than returning null: a missing bridge must stop the run before the
 * audio is uploaded, not fall through to a free transcription that we pay for.
 */
import type { PrecisionQuote } from './run-precision-job'

/** Resolves with the tx hash once the payment is mined; throws if the user declines. */
export type PrecisionPayment = (quote: PrecisionQuote) => Promise<string>

let payment: PrecisionPayment | null = null

export function registerPrecisionPayment(fn: PrecisionPayment): () => void {
  payment = fn
  return () => {
    if (payment === fn) payment = null
  }
}

export function getPrecisionPayment(): PrecisionPayment {
  if (!payment) {
    throw new Error('Precision payment is not registered: no wallet bridge is mounted')
  }
  return payment
}

/** For tests and for UI that wants to disable Precision before the bridge is ready. */
export function hasPrecisionPayment(): boolean {
  return payment !== null
}
