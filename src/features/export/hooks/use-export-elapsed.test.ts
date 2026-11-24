// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExportElapsedSeconds } from './use-export-elapsed'

/**
 * The finished dialog must report how long the export actually took.
 *
 * The old implementation ticked a `setInterval` against a start time captured in an effect and
 * stopped ticking when the view changed, so the number shown on completion was whatever the last
 * tick had been — and a sub-second run showed nothing at all, because the row is hidden at zero.
 */
describe('useExportElapsedSeconds', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-24T03:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const now = () => Date.now()

  it('reports 0 before an export starts', () => {
    const { result } = renderHook(() => useExportElapsedSeconds({ startedAt: null, endedAt: null }))
    expect(result.current).toBe(0)
  })

  it('advances while the export runs', () => {
    const startedAt = now()
    const { result } = renderHook(() => useExportElapsedSeconds({ startedAt, endedAt: null }))

    expect(result.current).toBe(0)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current).toBe(3)
  })

  it('reports the measured total on completion, not the last tick', () => {
    const startedAt = now()
    const { result, rerender } = renderHook(
      ({ endedAt }: { endedAt: number | null }) => useExportElapsedSeconds({ startedAt, endedAt }),
      { initialProps: { endedAt: null as number | null } },
    )

    act(() => {
      vi.advanceTimersByTime(2400) // two ticks, 0.4s short of the finish
    })
    expect(result.current).toBe(2)

    // The export settles 12.4s after the click; the ticker never saw it.
    rerender({ endedAt: startedAt + 12_400 })
    expect(result.current).toBe(12)
  })

  it('reports a sub-second export instead of hiding it', () => {
    const startedAt = now()
    const { result } = renderHook(() =>
      useExportElapsedSeconds({ startedAt, endedAt: startedAt + 900 }),
    )
    // No tick can have run for a run this short; the value comes from the timestamps alone.
    expect(result.current).toBe(1)
  })

  it('stops ticking once the end is known', () => {
    const startedAt = now()
    const { result } = renderHook(() =>
      useExportElapsedSeconds({ startedAt, endedAt: startedAt + 5000 }),
    )

    const settled = result.current
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current).toBe(settled)
  })
})
