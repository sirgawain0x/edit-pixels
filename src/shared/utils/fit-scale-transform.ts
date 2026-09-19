import type { TransformProperties } from '@/types/transform'

/** Scale source dimensions to fit within a canvas (letterbox), origin top-left. */
export function computeFitScaleTransform(
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): TransformProperties {
  const scaleX = canvasWidth / sourceWidth
  const scaleY = canvasHeight / sourceHeight
  const fitScale = Math.min(scaleX, scaleY)

  return {
    x: 0,
    y: 0,
    width: Math.round(sourceWidth * fitScale),
    height: Math.round(sourceHeight * fitScale),
    rotation: 0,
  }
}
