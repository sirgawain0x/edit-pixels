// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { selectLiveLooksRendererBackend } from './select-renderer-backend'

describe('selectLiveLooksRendererBackend', () => {
  it('prefers webgpu when navigator.gpu is present', () => {
    expect(
      selectLiveLooksRendererBackend({
        hasNavigatorGpu: true,
        hasWebGl2: true,
      }),
    ).toBe('webgpu')
  })

  it('falls back to webgl when webgpu is unavailable', () => {
    expect(
      selectLiveLooksRendererBackend({
        hasNavigatorGpu: false,
        hasWebGl2: true,
      }),
    ).toBe('webgl')
  })

  it('falls back to canvas2d when no GPU APIs are available', () => {
    expect(
      selectLiveLooksRendererBackend({
        hasNavigatorGpu: false,
        hasWebGl2: false,
        hasWebGl: false,
      }),
    ).toBe('canvas2d')
  })
})
