/**
 * Editor density presets.
 *
 * `compact` is tuned to keep more of the editor visible on a 1920x1080 display.
 * `tablet` / `phone` are selected automatically from viewport width.
 *
 * Prefer changing presets here before editing one-off component sizes.
 */
// fallow-ignore-file unused-export

const EDIT_DOPESHEET_COLUMN_WIDTH = 288

const COMPACT_LAYOUT = {
  toolbarHeight: 48,
  sidebarRailWidth: 44,
  sidebarHeaderHeight: 36,
  sidebarHeaderButtonSize: 20,
  toolbarButtonSize: 20,
  leftSidebarDefaultWidth: 320,
  leftSidebarMinWidth: 240,
  leftSidebarMaxWidth: 560,
  rightSidebarDefaultWidth: 288,
  rightSidebarMinWidth: 280,
  rightSidebarMaxWidth: 420,
  previewPadding: 32,
  previewSplitHeaderHeight: 32,
  previewControlsHeight: 32,
  previewControlButtonSize: 30,
  timelineDefaultSize: 28,
  timelineMinSize: 14,
  timelineMaxSize: 80,
  graphPanelSizeIncrease: 10,
  timelineHeaderHeight: 40,
  timelineTracksHeaderHeight: 34,
  timelineRulerHeight: 34,
  timelineSidebarWidth: EDIT_DOPESHEET_COLUMN_WIDTH,
  timelineMeterWidth: 84,
  timelineMixerWidth: 260,
  timelineTrackHeight: 100,
  timelineClipLabelRowHeight: 24,
  timelineWaveformRowHeight: 24,
} as const

const EDITOR_DENSITY_PRESETS = {
  compact: COMPACT_LAYOUT,
  tablet: {
    ...COMPACT_LAYOUT,
    toolbarHeight: 44,
    sidebarRailWidth: 48,
    leftSidebarDefaultWidth: 300,
    leftSidebarMinWidth: 260,
    rightSidebarDefaultWidth: 300,
    rightSidebarMinWidth: 260,
    previewPadding: 16,
    timelineDefaultSize: 32,
    timelineTrackHeight: 88,
  },
  phone: {
    ...COMPACT_LAYOUT,
    toolbarHeight: 44,
    sidebarRailWidth: 0,
    leftSidebarDefaultWidth: 360,
    leftSidebarMinWidth: 280,
    leftSidebarMaxWidth: 420,
    rightSidebarDefaultWidth: 360,
    rightSidebarMinWidth: 280,
    rightSidebarMaxWidth: 420,
    previewPadding: 8,
    previewControlsHeight: 40,
    previewControlButtonSize: 36,
    timelineDefaultSize: 22,
    timelineMinSize: 18,
    timelineMaxSize: 45,
    timelineHeaderHeight: 36,
    timelineTracksHeaderHeight: 28,
    timelineRulerHeight: 28,
    timelineSidebarWidth: 120,
    timelineMeterWidth: 0,
    timelineMixerWidth: 0,
    timelineTrackHeight: 64,
    timelineClipLabelRowHeight: 18,
    timelineWaveformRowHeight: 18,
  },
} as const

export type EditorDensityPresetName = keyof typeof EDITOR_DENSITY_PRESETS
export type EditorLayout = (typeof EDITOR_DENSITY_PRESETS)[EditorDensityPresetName]
type LeftSidebarLayoutBounds = { leftSidebarMinWidth: number; leftSidebarMaxWidth: number }
type RightSidebarLayoutBounds = { rightSidebarMinWidth: number; rightSidebarMaxWidth: number }

export type EditorViewportMode = 'desktop' | 'tablet' | 'phone'

/** Breakpoints (px): phone < tabletMin ≤ tablet < desktopMin ≤ desktop */
export const EDITOR_VIEWPORT_TABLET_MIN = 768
export const EDITOR_VIEWPORT_DESKTOP_MIN = 1100

export function resolveEditorViewportMode(width: number): EditorViewportMode {
  if (!Number.isFinite(width) || width <= 0) return 'desktop'
  if (width < EDITOR_VIEWPORT_TABLET_MIN) return 'phone'
  if (width < EDITOR_VIEWPORT_DESKTOP_MIN) return 'tablet'
  return 'desktop'
}

export function densityPresetForViewport(mode: EditorViewportMode): EditorDensityPresetName {
  if (mode === 'phone') return 'phone'
  if (mode === 'tablet') return 'tablet'
  return 'compact'
}

export const DEFAULT_EDITOR_DENSITY_PRESET: EditorDensityPresetName = 'compact'

export function normalizeEditorDensityPreset(value: unknown): EditorDensityPresetName {
  if (value === 'compact' || value === 'tablet' || value === 'phone') return value
  return DEFAULT_EDITOR_DENSITY_PRESET
}

export function getEditorLayout(preset: unknown = DEFAULT_EDITOR_DENSITY_PRESET): EditorLayout {
  return EDITOR_DENSITY_PRESETS[normalizeEditorDensityPreset(preset)]
}

export const EDITOR_LAYOUT = getEditorLayout()

const EDITOR_LAYOUT_CSS_VAR_NAMES = {
  toolbarHeight: '--editor-toolbar-height',
  sidebarRailWidth: '--editor-sidebar-rail-width',
  sidebarHeaderHeight: '--editor-sidebar-header-height',
  sidebarHeaderButtonSize: '--editor-sidebar-header-button-size',
  toolbarButtonSize: '--editor-toolbar-button-size',
  previewPadding: '--editor-preview-padding',
  previewSplitHeaderHeight: '--editor-preview-split-header-height',
  previewControlsHeight: '--editor-preview-controls-height',
  previewControlButtonSize: '--editor-preview-control-button-size',
  timelineHeaderHeight: '--editor-timeline-header-height',
  timelineTracksHeaderHeight: '--editor-timeline-tracks-header-height',
  timelineRulerHeight: '--editor-timeline-ruler-height',
  timelineSidebarWidth: '--editor-timeline-sidebar-width',
  timelineMeterWidth: '--editor-timeline-meter-width',
  timelineMixerWidth: '--editor-timeline-mixer-width',
  timelineTrackHeight: '--editor-timeline-track-height',
  timelineClipLabelRowHeight: '--editor-timeline-clip-label-row-height',
  timelineWaveformRowHeight: '--editor-timeline-waveform-row-height',
} as const

export const EDITOR_LAYOUT_CSS_VALUES = {
  toolbarHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.toolbarHeight})`,
  sidebarRailWidth: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarRailWidth})`,
  sidebarHeaderHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarHeaderHeight})`,
  sidebarHeaderButtonSize: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarHeaderButtonSize})`,
  toolbarButtonSize: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.toolbarButtonSize})`,
  previewPadding: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.previewPadding})`,
  previewSplitHeaderHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.previewSplitHeaderHeight})`,
  previewControlsHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.previewControlsHeight})`,
  previewControlButtonSize: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.previewControlButtonSize})`,
  timelineHeaderHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineHeaderHeight})`,
  timelineTracksHeaderHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineTracksHeaderHeight})`,
  timelineRulerHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineRulerHeight})`,
  timelineSidebarWidth: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineSidebarWidth})`,
  timelineMeterWidth: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineMeterWidth})`,
  timelineMixerWidth: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineMixerWidth})`,
  timelineTrackHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineTrackHeight})`,
  timelineClipLabelRowHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineClipLabelRowHeight})`,
  timelineWaveformRowHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineWaveformRowHeight})`,
} as const

export function getEditorLayoutCssVars(layout = EDITOR_LAYOUT): Record<string, string> {
  return {
    [EDITOR_LAYOUT_CSS_VAR_NAMES.toolbarHeight]: `${layout.toolbarHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarRailWidth]: `${layout.sidebarRailWidth}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarHeaderHeight]: `${layout.sidebarHeaderHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarHeaderButtonSize]: `${layout.sidebarHeaderButtonSize}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.toolbarButtonSize]: `${layout.toolbarButtonSize}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.previewPadding]: `${layout.previewPadding}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.previewSplitHeaderHeight]: `${layout.previewSplitHeaderHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.previewControlsHeight]: `${layout.previewControlsHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.previewControlButtonSize]: `${layout.previewControlButtonSize}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineHeaderHeight]: `${layout.timelineHeaderHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineTracksHeaderHeight]: `${layout.timelineTracksHeaderHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineRulerHeight]: `${layout.timelineRulerHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineSidebarWidth]: `${layout.timelineSidebarWidth}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineMeterWidth]: `${layout.timelineMeterWidth}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineMixerWidth]: `${layout.timelineMixerWidth}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineTrackHeight]: `${layout.timelineTrackHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineClipLabelRowHeight]: `${layout.timelineClipLabelRowHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineWaveformRowHeight]: `${layout.timelineWaveformRowHeight}px`,
  }
}

const LEFT_SIDEBAR_MAX_VIEWPORT_RATIO = 0.45

function clampSidebarWidth(width: number, bounds: { minWidth: number; maxWidth: number }): number {
  return Math.min(bounds.maxWidth, Math.max(bounds.minWidth, width))
}

function getViewportWidth(): number | null {
  if (
    typeof window !== 'undefined' &&
    Number.isFinite(window.innerWidth) &&
    window.innerWidth > 0
  ) {
    return window.innerWidth
  }

  if (typeof document !== 'undefined') {
    const documentWidth = document.documentElement?.clientWidth
    if (Number.isFinite(documentWidth) && documentWidth > 0) {
      return documentWidth
    }
  }

  return null
}

export function getLeftEditorSidebarBounds(
  layoutOrPreset: EditorLayout | LeftSidebarLayoutBounds | EditorDensityPresetName = EDITOR_LAYOUT,
): { minWidth: number; maxWidth: number } {
  const layout =
    typeof layoutOrPreset === 'string' ? getEditorLayout(layoutOrPreset) : layoutOrPreset
  const viewportWidth = getViewportWidth()
  const viewportMaxWidth =
    viewportWidth === null
      ? layout.leftSidebarMaxWidth
      : Math.floor(viewportWidth * LEFT_SIDEBAR_MAX_VIEWPORT_RATIO)

  return {
    minWidth: layout.leftSidebarMinWidth,
    maxWidth: Math.max(
      layout.leftSidebarMinWidth,
      Math.min(layout.leftSidebarMaxWidth, viewportMaxWidth),
    ),
  }
}

export function getRightEditorSidebarBounds(
  layoutOrPreset: EditorLayout | RightSidebarLayoutBounds | EditorDensityPresetName = EDITOR_LAYOUT,
): { minWidth: number; maxWidth: number } {
  const layout =
    typeof layoutOrPreset === 'string' ? getEditorLayout(layoutOrPreset) : layoutOrPreset

  return {
    minWidth: layout.rightSidebarMinWidth,
    maxWidth: layout.rightSidebarMaxWidth,
  }
}

export function clampLeftEditorSidebarWidth(
  width: number,
  layoutOrPreset: EditorLayout | EditorDensityPresetName = EDITOR_LAYOUT,
): number {
  return clampSidebarWidth(width, getLeftEditorSidebarBounds(layoutOrPreset))
}

export function clampRightEditorSidebarWidth(
  width: number,
  layoutOrPreset: EditorLayout | EditorDensityPresetName = EDITOR_LAYOUT,
): number {
  return clampSidebarWidth(width, getRightEditorSidebarBounds(layoutOrPreset))
}
