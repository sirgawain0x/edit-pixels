/**
 * How long an export took, in words a person reads at a glance.
 *
 * A run can finish inside the first second, and `Math.round` turns 400 ms into `0`. That zero used
 * to hide the row entirely — the dialog showed no time at all for a fast export, which reads as
 * "the number is broken" rather than "it was quick". Sub-second durations say so.
 */
export function formatExportDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return '<1s'
  if (seconds < 60) return `${Math.round(seconds)}s`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}
