/**
 * Export watermark.
 *
 * Exported video carries the CRTV mark unless the run holds a paid removal. The frame loop is
 * the only place to do this: anything applied afterwards would be a second video encode, and
 * anything applied in the UI would not survive a re-export.
 *
 * Three things shape this module:
 *
 * 1. The mark is drawn *after* the frame has been scaled to the export resolution, so it is
 *    always the same proportion of the picture — a 4K export and a 720p export match.
 * 2. Export can run inside a Web Worker (`export-render.worker.ts`), where `Image` does not
 *    exist. The loader therefore prefers `createImageBitmap`, which works on both threads.
 * 3. The shipped asset is a PNG, not the SVG. `createImageBitmap` cannot decode an SVG blob in
 *    Chrome (`InvalidStateError: The source image could not be decoded`) and a worker has no
 *    `<img>` to fall back on, so an SVG mark made every export fail on the path production
 *    uses. `scripts/build-watermark-png.mjs` rasterises the SVG the design ships.
 */

/** Fraction of the shorter edge the mark occupies. Small enough to stay out of the way. */
const MARK_SCALE = 0.09
/** Fraction of the shorter edge kept clear between the mark and the frame edges. */
const MARK_MARGIN = 0.035
/** The artwork already carries its own colour; only a slight knock-back so it sits on the frame. */
const MARK_OPACITY = 0.9

const WATERMARK_SRC = '/brand/crtv-watermark.png'

/** A missing mark is a revenue leak nobody would notice, so it fails the export instead. */
export class WatermarkUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Export watermark could not be loaded')
    this.name = 'WatermarkUnavailableError'
    this.cause = cause
  }
}

export interface WatermarkRect {
  x: number
  y: number
  width: number
  height: number
}

/** The mark plus its own pixel size, normalised across `Image` and `ImageBitmap`. */
export interface WatermarkImage {
  source: CanvasImageSource
  width: number
  height: number
}

/**
 * The slice of a 2D context the mark needs. Export uses an `OffscreenCanvas` context, which is
 * not assignable to `CanvasRenderingContext2D`, so the parameter is structural.
 */
export interface WatermarkContext {
  globalAlpha: number
  save(): void
  restore(): void
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void
}

/**
 * Bottom-right placement for a mark of the given aspect ratio (width / height).
 *
 * Pure, so the rules that matter can be asserted without a canvas: the mark never leaves the
 * frame, keeps its padding at any resolution, and stays proportional across aspect ratios.
 */
export function computeWatermarkRect(input: {
  frameWidth: number
  frameHeight: number
  markAspect: number
}): WatermarkRect {
  const { frameWidth, frameHeight, markAspect } = input
  const shorterEdge = Math.min(frameWidth, frameHeight)
  const width = Math.max(1, Math.round(shorterEdge * MARK_SCALE))
  const height = Math.max(1, Math.round(width / Math.max(markAspect, 0.01)))
  const margin = Math.round(shorterEdge * MARK_MARGIN)

  return {
    x: Math.max(0, frameWidth - width - margin),
    y: Math.max(0, frameHeight - height - margin),
    width,
    height,
  }
}

/** Worker-safe path: `createImageBitmap` exists on both the main thread and in workers. */
async function loadViaImageBitmap(src: string): Promise<WatermarkImage | null> {
  if (typeof createImageBitmap !== 'function') return null

  const response = await fetch(src)
  if (!response.ok) throw new WatermarkUnavailableError(`HTTP ${response.status}`)

  try {
    const bitmap = await createImageBitmap(await response.blob())
    return { source: bitmap, width: bitmap.width, height: bitmap.height }
  } catch {
    // An engine can refuse a format it cannot decode here while still drawing it through
    // `<img>`. That is not a missing asset, so the next route gets a turn.
    return null
  }
}

/** Fallback for engines without `createImageBitmap` on the main thread. */
async function loadViaImageElement(src: string): Promise<WatermarkImage | null> {
  if (typeof Image === 'undefined') return null

  return new Promise((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () =>
      resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve(null)
    image.src = src
  })
}

/**
 * Rasterise the mark once per export.
 *
 * The source is a 148 KB SVG full of filters; doing this per frame would dominate the encode.
 * Loaded once, each frame costs a single `drawImage`.
 */
export async function loadWatermarkImage(src: string = WATERMARK_SRC): Promise<WatermarkImage> {
  const image = (await loadViaImageBitmap(src)) ?? (await loadViaImageElement(src))
  if (!image || image.width <= 0 || image.height <= 0) throw new WatermarkUnavailableError()
  return image
}

/** Draw the mark in the bottom-right corner of the current frame. No-op without an image. */
export function drawWatermark(
  ctx: WatermarkContext,
  image: WatermarkImage | null,
  frameWidth: number,
  frameHeight: number,
): void {
  if (!image) return

  const aspect = image.width / Math.max(image.height, 1)
  const rect = computeWatermarkRect({ frameWidth, frameHeight, markAspect: aspect })

  ctx.save()
  ctx.globalAlpha = MARK_OPACITY
  ctx.drawImage(image.source, rect.x, rect.y, rect.width, rect.height)
  ctx.restore()
}
