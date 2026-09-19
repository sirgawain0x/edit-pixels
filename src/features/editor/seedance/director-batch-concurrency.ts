/**
 * Concurrent provider call cap for Director batch render queue.
 * Default 20 (G2); override via VITE_DIRECTOR_BATCH_CONCURRENCY when set.
 */

export const DIRECTOR_BATCH_CONCURRENCY_DEFAULT = 20

function parseConcurrencyEnv(raw: string | undefined): number | null {
  if (!raw?.trim()) return null
  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return parsed
}

/** Resolved concurrency for the batch render worker pool. */
export function resolveDirectorBatchConcurrency(): number {
  const fromEnv = parseConcurrencyEnv(import.meta.env.VITE_DIRECTOR_BATCH_CONCURRENCY)
  return fromEnv ?? DIRECTOR_BATCH_CONCURRENCY_DEFAULT
}
