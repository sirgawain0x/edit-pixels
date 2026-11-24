import { describe, expect, it } from 'vite-plus/test'
import { formatExportDuration } from './format-export-duration'

/**
 * A run can finish inside the first second. Rounding that to `0` used to hide the row entirely,
 * which reads as a broken number rather than a fast export.
 */
describe('formatExportDuration', () => {
  it('says a sub-second export was under a second', () => {
    expect(formatExportDuration(0)).toBe('<1s')
    expect(formatExportDuration(0.4)).toBe('<1s')
    expect(formatExportDuration(0.999)).toBe('<1s')
  })

  it('rounds whole seconds', () => {
    expect(formatExportDuration(1)).toBe('1s')
    expect(formatExportDuration(41)).toBe('41s')
    expect(formatExportDuration(59.4)).toBe('59s')
  })

  it('switches to minutes past a minute', () => {
    expect(formatExportDuration(60)).toBe('1m 0s')
    expect(formatExportDuration(125)).toBe('2m 5s')
    expect(formatExportDuration(3599)).toBe('59m 59s')
  })

  it('treats a nonsensical value as unmeasurable rather than printing NaN', () => {
    expect(formatExportDuration(Number.NaN)).toBe('<1s')
    expect(formatExportDuration(-5)).toBe('<1s')
  })
})
