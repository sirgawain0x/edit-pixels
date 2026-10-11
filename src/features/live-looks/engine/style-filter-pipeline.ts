import type { LiveLooksRendererBackend, LiveLooksStyleFilter } from './types'
import { selectLiveLooksRendererBackend } from './select-renderer-backend'
import { applyCanvas2dStyleFilter } from './style-filter-canvas2d'
import { WebGlStyleFilterRenderer } from './style-filter-webgl'
import { createWebGpuStyleFilterRenderer } from './style-filter-webgpu'

export interface StyleFilterPipeline {
  backend: LiveLooksRendererBackend
  resize(width: number, height: number): void
  apply(source: CanvasImageSource, filter: LiveLooksStyleFilter): HTMLCanvasElement
  dispose(): void
}

export async function createStyleFilterPipeline(
  width: number,
  height: number,
): Promise<StyleFilterPipeline> {
  const preference = selectLiveLooksRendererBackend()

  if (preference === 'webgpu') {
    const webgpu = await createWebGpuStyleFilterRenderer(width, height)
    if (webgpu) {
      return {
        backend: 'webgpu',
        resize: (w, h) => webgpu.resize(w, h),
        apply: (source, filter) => webgpu.apply(source, filter),
        dispose: () => webgpu.dispose(),
      }
    }
  }

  const webgl = WebGlStyleFilterRenderer.tryCreate(width, height)
  if (webgl) {
    return {
      backend: 'webgl',
      resize: (w, h) => webgl.resize(w, h),
      apply: (source, filter) => webgl.apply(source, filter),
      dispose: () => webgl.dispose(),
    }
  }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) {
    throw new Error('Unable to create Live Looks canvas context')
  }

  let w = width
  let h = height
  canvas.width = w
  canvas.height = h

  return {
    backend: 'canvas2d',
    resize: (nextW, nextH) => {
      w = nextW
      h = nextH
      canvas.width = w
      canvas.height = h
    },
    apply: (source, filter) => {
      applyCanvas2dStyleFilter(source, ctx, w, h, filter)
      return canvas
    },
    dispose: () => {},
  }
}
