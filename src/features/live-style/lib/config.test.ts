// @vitest-environment node
import { describe, expect, it } from 'vite-plus/test'
import { parseCapPresetUsd } from './config'

describe('parseCapPresetUsd', () => {
  it('accepts valid presets', () => {
    expect(parseCapPresetUsd(1)).toBe(1)
    expect(parseCapPresetUsd(3)).toBe(3)
    expect(parseCapPresetUsd(6)).toBe(6)
    expect(parseCapPresetUsd('3')).toBe(3)
  })

  it('rejects invalid values', () => {
    expect(parseCapPresetUsd(2)).toBeNull()
    expect(parseCapPresetUsd('x')).toBeNull()
  })
})
