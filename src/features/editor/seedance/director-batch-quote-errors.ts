import { PixelsGenerateApiError } from './seedance-client'

const VEO_QUOTE_FAILED = /^veo quote failed for shot /i
const INVALID_SHOT = /^invalid shot:/i
const DUPLICATE_SHOT = /^duplicate shotId:/i

/** Map batch quote / confirm API failures to editor-friendly copy. */
export function formatDirectorBatchQuoteError(error: unknown): string {
  if (error instanceof PixelsGenerateApiError) {
    return error.message
  }

  if (error instanceof Error) {
    const raw = error.message.trim()
    if (!raw) return 'Batch quote failed — try again.'

    if (VEO_QUOTE_FAILED.test(raw)) {
      return 'Could not price one or more shots with Veo — try Seedance or adjust shot durations.'
    }
    if (raw === 'feature_disabled') {
      return 'Batch render is not enabled in this environment.'
    }
    if (raw === 'invalid shots' || raw === 'shots required') {
      return 'Storyboard shots could not be quoted — regenerate the storyboard and try again.'
    }
    if (raw.startsWith('too many shots')) {
      return 'Storyboard has too many shots for one batch (max 50) — split into smaller storyboards.'
    }
    if (INVALID_SHOT.test(raw) || DUPLICATE_SHOT.test(raw)) {
      return 'Storyboard shot data is invalid — regenerate the storyboard and refresh the quote.'
    }
    if (raw.includes('Failed to fetch') || raw.includes('NetworkError')) {
      return 'Network error while fetching the batch quote — check your connection and try again.'
    }

    return raw
  }

  return 'Batch quote failed — try again.'
}
