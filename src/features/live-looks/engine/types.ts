export type LiveLooksRendererBackend = 'webgpu' | 'webgl' | 'canvas2d'

export type LiveLooksBackgroundMode = 'none' | 'blur' | 'solid' | 'preset' | 'custom'

export type LiveLooksStyleFilter =
  | 'none'
  | 'mono'
  | 'warm'
  | 'cool'
  | 'highContrast'
  | 'comic'
  | 'vhs'

export interface LiveLooksBackgroundState {
  mode: LiveLooksBackgroundMode
  blurRadius: number
  solidColor: string
  presetId: string | null
  customImageUrl: string | null
}

export interface LiveLooksSettings {
  background: LiveLooksBackgroundState
  styleFilter: LiveLooksStyleFilter
}

export const DEFAULT_LIVE_LOOKS_SETTINGS: LiveLooksSettings = {
  background: {
    mode: 'blur',
    blurRadius: 16,
    solidColor: '#1e293b',
    presetId: 'studio',
    customImageUrl: null,
  },
  styleFilter: 'none',
}

export interface BundledBackgroundPreset {
  id: string
  labelKey: string
  url: string
}

export const BUNDLED_BACKGROUND_PRESETS: BundledBackgroundPreset[] = [
  {
    id: 'studio',
    labelKey: 'liveLooks.background.presets.studio',
    url: '/live-looks/backgrounds/studio.svg',
  },
  {
    id: 'sunset',
    labelKey: 'liveLooks.background.presets.sunset',
    url: '/live-looks/backgrounds/sunset.svg',
  },
  {
    id: 'forest',
    labelKey: 'liveLooks.background.presets.forest',
    url: '/live-looks/backgrounds/forest.svg',
  },
]
