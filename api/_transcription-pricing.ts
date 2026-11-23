/**
 * Transcription pricing constants used by Vercel functions.
 *
 * IMPORTANT: do not import from `headless/lib/` or `src/` inside `api/` routes.
 * This file duplicates the values from `headless/lib/billing/pricing.mjs` so
 * that the function bundle stays self-contained.
 *
 * Drift is guarded by `headless/transcription-pricing-parity.test.mjs`, which
 * asserts these literals match the headless source and that the cap is derived
 * from the ceiling minutes.
 */

/** $0.0075 USDC per minute of submitted audio. */
export const TRANSCRIPTION_USDC6_PER_AUDIO_MINUTE = 7_500

/** $3.60 USDC ceiling for a single transcription run. */
export const TRANSCRIPTION_RUN_CAP_USDC6 = 3_600_000

/** Hard ceiling on source audio for one run; longer jobs must be split. */
export const TRANSCRIPTION_MAX_AUDIO_MINUTES = 480

/** Chirp 3 batch rate in usdc6 per submitted second (used for retry/abort budgets). */
export const CHIRP3_BATCH_USDC6_PER_SEC = 50
