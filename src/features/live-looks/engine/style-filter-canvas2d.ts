import type { LiveLooksStyleFilter } from './types'

const FILTER_CSS: Record<LiveLooksStyleFilter, string> = {
  none: 'none',
  mono: 'grayscale(1) saturate(0.2)',
  warm: 'sepia(0.35) saturate(1.25) contrast(1.05)',
  cool: 'hue-rotate(195deg) saturate(0.85) contrast(1.05)',
  highContrast: 'contrast(1.55) saturate(1.1)',
  comic: 'contrast(1.75) saturate(1.35) brightness(1.05)',
  vhs: 'contrast(1.15) saturate(0.75) brightness(1.08) hue-rotate(-8deg)',
}

export function applyCanvas2dStyleFilter(
  source: CanvasImageSource,
  target: CanvasRenderingContext2D,
  width: number,
  height: number,
  filter: LiveLooksStyleFilter,
): void {
  const css = FILTER_CSS[filter]
  target.filter = css
  target.clearRect(0, 0, width, height)
  target.drawImage(source, 0, 0, width, height)
  target.filter = 'none'
}
