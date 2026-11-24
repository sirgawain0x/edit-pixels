import { useEffect, useState } from 'react'

/**
 * Wall-clock duration of an export, measured from real timestamps.
 *
 * The previous implementation ticked a `setInterval` against a start time captured inside an
 * effect, and simply stopped ticking when the view changed on completion. Three consequences, all
 * of which make the reported number disagree with the clock on the wall:
 *
 * - the start time was taken whenever React happened to flush the view change, so any blocking
 *   preparation that ran before that flush was not counted;
 * - the final value was the last one-second tick, not the finish time;
 * - a run that finished in under a second reported nothing at all, because the row is hidden at 0.
 *
 * Taking both ends as timestamps removes each of those. The ticker exists only to make the number
 * move while the export is running.
 */
export function useExportElapsedSeconds({
  startedAt,
  endedAt,
}: {
  startedAt: number | null
  endedAt: number | null
}): number {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (startedAt === null || endedAt !== null) return
    const interval = setInterval(() => setTick((value) => value + 1), 1000)
    return () => clearInterval(interval)
  }, [startedAt, endedAt])

  if (startedAt === null) return 0
  return Math.max(0, Math.round(((endedAt ?? Date.now()) - startedAt) / 1000))
}
