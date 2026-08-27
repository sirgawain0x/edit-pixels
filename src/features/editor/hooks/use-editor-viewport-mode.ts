import { useEffect, useState } from 'react'
import {
  densityPresetForViewport,
  resolveEditorViewportMode,
  type EditorDensityPresetName,
  type EditorViewportMode,
} from '@/config/editor-layout'

function readMode(): EditorViewportMode {
  if (typeof window === 'undefined') return 'desktop'
  return resolveEditorViewportMode(window.innerWidth)
}

/**
 * Tracks editor chrome mode from viewport width (resize-aware).
 */
export function useEditorViewportMode(): {
  mode: EditorViewportMode
  densityPreset: EditorDensityPresetName
  isDesktop: boolean
  isTablet: boolean
  isPhone: boolean
} {
  const [mode, setMode] = useState<EditorViewportMode>(readMode)

  useEffect(() => {
    const onResize = () => setMode(resolveEditorViewportMode(window.innerWidth))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return {
    mode,
    densityPreset: densityPresetForViewport(mode),
    isDesktop: mode === 'desktop',
    isTablet: mode === 'tablet',
    isPhone: mode === 'phone',
  }
}
