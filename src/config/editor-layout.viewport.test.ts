import { describe, expect, it } from 'vitest'
import { densityPresetForViewport, resolveEditorViewportMode } from '@/config/editor-layout'

describe('editor viewport mode', () => {
  it('classifies phone / tablet / desktop breakpoints', () => {
    expect(resolveEditorViewportMode(400)).toBe('phone')
    expect(resolveEditorViewportMode(800)).toBe('tablet')
    expect(resolveEditorViewportMode(1280)).toBe('desktop')
  })

  it('maps viewport to density presets', () => {
    expect(densityPresetForViewport('phone')).toBe('phone')
    expect(densityPresetForViewport('tablet')).toBe('tablet')
    expect(densityPresetForViewport('desktop')).toBe('compact')
  })
})
