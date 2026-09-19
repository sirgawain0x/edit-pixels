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
