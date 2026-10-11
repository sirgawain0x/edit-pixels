import type { LiveLooksRendererBackend } from './types'

export interface RendererBackendProbe {
  hasNavigatorGpu?: boolean
  hasWebGl2?: boolean
  hasWebGl?: boolean
}

/**
 * Picks the style-filter backend without async GPU adapter negotiation.
 * WebGPU is selected when `navigator.gpu` exists; init may still fall back later.
 */
export function selectLiveLooksRendererBackend(
  probe: RendererBackendProbe = {},
): LiveLooksRendererBackend {
  const hasNavigatorGpu =
    probe.hasNavigatorGpu ??
    (typeof navigator !== 'undefined' && typeof navigator.gpu !== 'undefined')

  if (hasNavigatorGpu) {
    return 'webgpu'
  }

  const hasWebGl2 =
    probe.hasWebGl2 ??
    (typeof document !== 'undefined' &&
      (() => {
        const canvas = document.createElement('canvas')
        return Boolean(canvas.getContext('webgl2'))
      })())

  if (hasWebGl2 || probe.hasWebGl) {
    return 'webgl'
  }

  if (probe.hasWebGl === undefined && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    if (canvas.getContext('webgl')) {
      return 'webgl'
    }
  }

  return 'canvas2d'
}
