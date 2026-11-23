import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  computeWatermarkRect,
  drawWatermark,
  loadWatermarkImage,
  WatermarkUnavailableError,
  type WatermarkImage,
} from './watermark'

const SQUARE_MARK = 1

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('computeWatermarkRect', () => {
  it('sits in the bottom-right corner inside the frame', () => {
    const rect = computeWatermarkRect({
      frameWidth: 1920,
      frameHeight: 1080,
      markAspect: SQUARE_MARK,
    })

    expect(rect.x + rect.width).toBeLessThan(1920)
    expect(rect.y + rect.height).toBeLessThan(1080)
    expect(rect.x).toBeGreaterThan(1920 / 2)
    expect(rect.y).toBeGreaterThan(1080 / 2)
  })

  it('scales with the frame, so a 4K export and a 720p export look the same', () => {
    const small = computeWatermarkRect({ frameWidth: 1280, frameHeight: 720, markAspect: 1 })
    const large = computeWatermarkRect({ frameWidth: 3840, frameHeight: 2160, markAspect: 1 })

    // Three times the pixels, three times the mark — a fixed pixel size would look tiny at 4K.
    // Integer rounding costs a pixel, hence the tolerance.
    expect(Math.abs(large.width - small.width * 3)).toBeLessThanOrEqual(2)
  })

  it('sizes against the shorter edge, so a vertical export is not cropped or oversized', () => {
    const landscape = computeWatermarkRect({ frameWidth: 1920, frameHeight: 1080, markAspect: 1 })
    const portrait = computeWatermarkRect({ frameWidth: 1080, frameHeight: 1920, markAspect: 1 })

    expect(portrait.width).toBe(landscape.width)
  })

  it('keeps a non-square mark inside the frame using its own aspect', () => {
    const rect = computeWatermarkRect({
      frameWidth: 1920,
      frameHeight: 1080,
      markAspect: 2,
    })

    expect(Math.abs(rect.width - rect.height * 2)).toBeLessThanOrEqual(2)
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
  })

  it('never produces a zero-sized or negative mark on a degenerate frame', () => {
    const rect = computeWatermarkRect({ frameWidth: 4, frameHeight: 4, markAspect: 0 })

    expect(rect.width).toBeGreaterThan(0)
    expect(rect.height).toBeGreaterThan(0)
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
  })
})

describe('drawWatermark', () => {
  function fakeContext() {
    return {
      globalAlpha: 1,
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
    }
  }

  const image: WatermarkImage = {
    source: { id: 'mark' } as unknown as CanvasImageSource,
    width: 500,
    height: 500,
  }

  it('draws once, keeps the context state balanced, and restores alpha', () => {
    const ctx = fakeContext()

    drawWatermark(ctx, image, 1920, 1080)

    expect(ctx.save).toHaveBeenCalledTimes(1)
    expect(ctx.restore).toHaveBeenCalledTimes(1)
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
    // Alpha is set for the draw and handed back by restore, not left dirty for the next frame.
    expect(ctx.globalAlpha).not.toBe(1)
  })

  it('draws the mark at the computed corner, from the normalised source', () => {
    const ctx = fakeContext()

    drawWatermark(ctx, image, 1920, 1080)

    const [source, x, y, width, height] = vi.mocked(ctx.drawImage).mock.calls[0] ?? []
    expect(source).toBe(image.source)
    expect(x).toBeGreaterThan(0)
    expect(y).toBeGreaterThan(0)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  })

  it('draws nothing when the asset could not be loaded, so a per-frame miss cannot throw', () => {
    const ctx = fakeContext()

    drawWatermark(ctx, null, 1920, 1080)

    expect(ctx.drawImage).not.toHaveBeenCalled()
  })
})

describe('loadWatermarkImage', () => {
  it('rasterises through createImageBitmap, the only path available inside a worker', async () => {
    const bitmap = { width: 500, height: 500 }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['<svg/>']), { status: 200 })),
    )
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    )
    // A worker has no `Image`; if the loader depended on it, this call would fail.
    vi.stubGlobal('Image', undefined)

    const loaded = await loadWatermarkImage('/brand/crtv-watermark.svg')

    expect(loaded).toEqual({ source: bitmap, width: 500, height: 500 })
  })

  it('fails loudly when the asset is missing, rather than exporting an unmarked video', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    )
    vi.stubGlobal('createImageBitmap', vi.fn())

    await expect(loadWatermarkImage('/brand/missing.svg')).rejects.toBeInstanceOf(
      WatermarkUnavailableError,
    )
  })

  it('fails loudly when the environment can rasterise nothing at all', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('createImageBitmap', undefined)
    vi.stubGlobal('Image', undefined)

    await expect(loadWatermarkImage()).rejects.toBeInstanceOf(WatermarkUnavailableError)
  })
})
