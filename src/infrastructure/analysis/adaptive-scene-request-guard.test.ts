import { describe, expect, it } from 'vite-plus/test'
import { isAnalysisRequest } from './adaptive-scene-request-guard'

/**
 * The adaptive worker shares `self` with the object-URL registry listener, so registry broadcasts
 * arrive at its `onmessage` too. Treating one as work made the worker reject the real run that
 * followed with "Adaptive scene analysis worker is already busy".
 */
describe('isAnalysisRequest', () => {
  it('rejects a registry sync', () => {
    expect(
      isAnalysisRequest({
        type: 'edit-pixels:sync-object-url-registry',
        entries: [{ url: 'blob:x', blob: new Blob(['x']) }],
      }),
    ).toBe(false)
  })

  it('rejects registry add/remove broadcasts', () => {
    expect(isAnalysisRequest({ type: 'edit-pixels:add-object-url', url: 'blob:x' })).toBe(false)
    expect(isAnalysisRequest({ type: 'edit-pixels:remove-object-url', url: 'blob:x' })).toBe(false)
  })

  it('rejects anything without a requestId', () => {
    expect(isAnalysisRequest({ sourceUrl: 'blob:x' })).toBe(false)
    expect(isAnalysisRequest(null)).toBe(false)
    expect(isAnalysisRequest('nope')).toBe(false)
  })

  it('accepts an analyze request', () => {
    expect(isAnalysisRequest({ type: 'analyze', requestId: 'r-1', sourceUrl: 'blob:x' })).toBe(true)
  })

  it('accepts an abort, which carries only a requestId', () => {
    expect(isAnalysisRequest({ type: 'abort', requestId: 'r-1' })).toBe(true)
  })
})
