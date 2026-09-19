/**
 * Director batch enqueue concurrency by provider.
 *
 * G2 (locked): cap of 20 applies to Higgsfield / Seedance only (API-key concurrency).
 * Google Veo is pay-as-you-go and is not limited by the Higgsfield cap.
 */

/** Higgsfield / Seedance API-key concurrency default. */
export const DIRECTOR_BATCH_SEEDANCE_CONCURRENCY_DEFAULT = 20

function parseConcurrencyEnv(raw: string | undefined): number | null {
  if (!raw?.trim()) return null
  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return parsed
}

function readSeedanceConcurrencyEnv(): number | null {
  return (
    parseConcurrencyEnv(import.meta.env.VITE_DIRECTOR_BATCH_SEEDANCE_CONCURRENCY) ??
    parseConcurrencyEnv(import.meta.env.VITE_DIRECTOR_BATCH_CONCURRENCY)
  )
}

/** Resolved concurrency for Seedance (Higgsfield) batch enqueue worker pool. */
export function resolveDirectorBatchSeedanceConcurrency(): number {
  return readSeedanceConcurrencyEnv() ?? DIRECTOR_BATCH_SEEDANCE_CONCURRENCY_DEFAULT
}

/**
 * Veo batch enqueue concurrency — uncapped relative to batch size (pay-as-you-go).
 * All queued Veo jobs in a batch may run in parallel.
 */
export function resolveDirectorBatchVeoConcurrency(queuedVeoCount: number): number {
  return Math.max(0, queuedVeoCount)
}
