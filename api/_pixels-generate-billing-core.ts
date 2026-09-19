/**
 * Pure billing validation helpers (unit-tested).
 */
import type { SeedanceResolution } from './_seedance-pricing.js'

export interface SeedanceQuoteShape {
  quoteId: string
  duration: number
  resolution: SeedanceResolution
}

export type QuoteBindingResult =
  | { ok: true; quote: SeedanceQuoteShape }
  | { ok: false; error: 'quote_mismatch' }

export function bindSeedanceQuote(
  quoteId: string,
  quote: SeedanceQuoteShape | null,
  duration: number,
  resolution: SeedanceResolution,
): QuoteBindingResult {
  const trimmed = quoteId.trim()
  if (!trimmed || !quote) {
    return { ok: false, error: 'quote_mismatch' }
  }
  if (quote.quoteId !== trimmed) {
    return { ok: false, error: 'quote_mismatch' }
  }
  if (quote.duration !== duration || quote.resolution !== resolution) {
    return { ok: false, error: 'quote_mismatch' }
  }
  return { ok: true, quote }
}

export type BatchConfirmBindingResult =
  | { ok: true; paymentTxHash: string | null }
  | { ok: false; error: 'batch_confirm_mismatch' }

export interface BatchConfirmShotBindingInput {
  shotId: string
  requestId: string
  provider: 'veo' | 'seedance'
  started?: boolean
}

export interface BatchConfirmBindingInput {
  batchConfirmId: string
  wallet: string
  paymentTxHash: string | null
  shots: BatchConfirmShotBindingInput[]
}

export function bindBatchConfirmShot(
  confirm: BatchConfirmBindingInput,
  shotId: string,
  requestId: string,
  wallet: string,
): BatchConfirmBindingResult {
  const normalizedWallet = wallet.trim().toLowerCase()
  if (confirm.wallet !== normalizedWallet) {
    return { ok: false, error: 'batch_confirm_mismatch' }
  }

  const sid = shotId.trim()
  const rid = requestId.trim()
  const shot = confirm.shots.find((entry) => entry.shotId === sid && entry.requestId === rid)
  if (!shot) {
    return { ok: false, error: 'batch_confirm_mismatch' }
  }

  return { ok: true, paymentTxHash: confirm.paymentTxHash }
}
