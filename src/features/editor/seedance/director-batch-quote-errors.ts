import { PixelsGenerateApiError } from './seedance-client'

const VEO_QUOTE_FAILED = /^veo quote failed for shot /i
const INVALID_SHOT = /^invalid shot:/i
const DUPLICATE_SHOT = /^duplicate shotId:/i
const NETWORK_ERROR = /Failed to fetch|NetworkError/

const EXACT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  feature_disabled: 'Batch render is not enabled in this environment.',
  'invalid shots':
    'Storyboard shots could not be quoted — regenerate the storyboard and try again.',
  'shots required':
    'Storyboard shots could not be quoted — regenerate the storyboard and try again.',
}

function mapKnownErrorMessage(raw: string): string | null {
  const exact = EXACT_ERROR_MESSAGES[raw]
  if (exact) return exact
  if (VEO_QUOTE_FAILED.test(raw)) {
    return 'Could not price one or more shots with Veo — try Seedance or adjust shot durations.'
  }
  if (raw.startsWith('too many shots')) {
    return 'Storyboard has too many shots for one batch (max 50) — split into smaller storyboards.'
  }
  if (INVALID_SHOT.test(raw) || DUPLICATE_SHOT.test(raw)) {
    return 'Storyboard shot data is invalid — regenerate the storyboard and refresh the quote.'
  }
  if (NETWORK_ERROR.test(raw)) {
    return 'Network error while fetching the batch quote — check your connection and try again.'
  }
  return null
}

/** Map batch quote / confirm API failures to editor-friendly copy. */
export function formatDirectorBatchQuoteError(error: unknown): string {
  if (error instanceof PixelsGenerateApiError) {
    return error.message
  }

  if (!(error instanceof Error)) {
    return 'Batch quote failed — try again.'
  }

  const raw = error.message.trim()
  if (!raw) return 'Batch quote failed — try again.'

  return mapKnownErrorMessage(raw) ?? raw
}
