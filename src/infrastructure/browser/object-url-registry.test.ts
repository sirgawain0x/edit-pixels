import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  addObjectUrlSyncTarget,
  clearObjectUrlRegistry,
  isObjectUrlRegistryMessage,
  getObjectUrlRegistrySnapshot,
  registerObjectUrl,
  removeObjectUrlSyncTarget,
  SYNC_OBJECT_URL_REGISTRY,
  unregisterObjectUrl,
  ADD_OBJECT_URL,
  REMOVE_OBJECT_URL,
} from './object-url-registry'

describe('object-url-registry main-thread snapshot', () => {
  beforeEach(() => {
    clearObjectUrlRegistry()
  })

  it('returns a snapshot of registered entries', () => {
    const blob = new Blob(['hello'])
    registerObjectUrl('blob:test-snapshot', blob, { mediaId: 'media-1', fileSize: 5 })

    const snapshot = getObjectUrlRegistrySnapshot()
    expect(snapshot).not.toBeNull()
    expect(snapshot!.entries).toHaveLength(1)
    expect(snapshot!.entries[0]!.url).toBe('blob:test-snapshot')
    expect(snapshot!.entries[0]!.blob).toBe(blob)
    expect(snapshot!.entries[0]!.metadata).toEqual({ mediaId: 'media-1', fileSize: 5 })
  })

  it('omits non-serializable fileHandle from the snapshot metadata', () => {
    const blob = new Blob(['hello'])
    const fileHandle = {} as FileSystemFileHandle
    registerObjectUrl('blob:test-handle', blob, {
      mediaId: 'media-2',
      fileHandle,
      opfsPath: 'content/file.mp4',
    })

    const snapshot = getObjectUrlRegistrySnapshot()
    expect(snapshot!.entries[0]!.metadata).toEqual({
      mediaId: 'media-2',
      opfsPath: 'content/file.mp4',
    })
  })
})

describe('object-url-registry sync target broadcasting', () => {
  beforeEach(() => {
    clearObjectUrlRegistry()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('broadcasts additions and removals to registered sync targets', () => {
    const target = { postMessage: vi.fn() } as unknown as Worker
    addObjectUrlSyncTarget(target)

    const blob = new Blob(['hello'])
    registerObjectUrl('blob:broadcast-add', blob, { mediaId: 'media-3' })
    expect(target.postMessage).toHaveBeenCalledWith({
      type: ADD_OBJECT_URL,
      url: 'blob:broadcast-add',
      blob,
      metadata: { mediaId: 'media-3' },
    })

    ;(target.postMessage as ReturnType<typeof vi.fn>).mockClear()
    unregisterObjectUrl('blob:broadcast-add')
    expect(target.postMessage).toHaveBeenCalledWith({
      type: REMOVE_OBJECT_URL,
      url: 'blob:broadcast-add',
    })

    removeObjectUrlSyncTarget(target)
  })
})

describe('object-url-registry worker listener', () => {
  afterEach(() => {
    clearObjectUrlRegistry()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function importInWorkerContext(): Promise<typeof import('./object-url-registry')> {
    vi.stubGlobal('document', undefined)
    const fakeSelf = new EventTarget()
    vi.stubGlobal('self', fakeSelf)
    vi.resetModules()
    return import('./object-url-registry')
  }

  it('registers replayed entries when running in a worker context', async () => {
    const registry = await importInWorkerContext()
    const blob = new Blob(['worker-blob'])

    const fakeSelf = self as unknown as EventTarget
    fakeSelf.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: SYNC_OBJECT_URL_REGISTRY,
          entries: [{ url: 'blob:worker-replay', blob, metadata: { mediaId: 'media-w' } }],
        },
      }),
    )

    expect(registry.getObjectUrlBlob('blob:worker-replay')).toBe(blob)
  })

  it('applies incremental add and remove messages in a worker context', async () => {
    const registry = await importInWorkerContext()
    const blob = new Blob(['worker-blob'])
    const fakeSelf = self as unknown as EventTarget

    fakeSelf.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: ADD_OBJECT_URL,
          url: 'blob:worker-add',
          blob,
          metadata: { mediaId: 'media-add' },
        },
      }),
    )
    expect(registry.getObjectUrlBlob('blob:worker-add')).toBe(blob)

    fakeSelf.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: REMOVE_OBJECT_URL,
          url: 'blob:worker-add',
        },
      }),
    )
    expect(registry.getObjectUrlBlob('blob:worker-add')).toBeNull()
  })
})

describe('isObjectUrlRegistryMessage', () => {
  it('matches registry broadcast types only', () => {
    expect(
      isObjectUrlRegistryMessage({
        type: SYNC_OBJECT_URL_REGISTRY,
        entries: [],
      }),
    ).toBe(true)
    expect(
      isObjectUrlRegistryMessage({ type: ADD_OBJECT_URL, url: 'blob:x', blob: new Blob() }),
    ).toBe(true)
    expect(isObjectUrlRegistryMessage({ type: REMOVE_OBJECT_URL, url: 'blob:x' })).toBe(true)
    expect(isObjectUrlRegistryMessage({ type: 'warm', requestId: 'r1' })).toBe(false)
    expect(isObjectUrlRegistryMessage(null)).toBe(false)
  })

  it('recognises the three sync messages', () => {
    for (const type of [SYNC_OBJECT_URL_REGISTRY, ADD_OBJECT_URL, REMOVE_OBJECT_URL]) {
      expect(isObjectUrlRegistryMessage({ type })).toBe(true)
    }
  })

  it('leaves worker protocol messages alone', () => {
    // Filmstrip/audio/waveform workers switch on `type` and throw on an unknown one, so only the
    // registry's own messages may be filtered out.
    expect(isObjectUrlRegistryMessage({ type: 'extract', requestId: 'r-1' })).toBe(false)
    expect(isObjectUrlRegistryMessage({ type: 'decode', mediaId: 'm-1' })).toBe(false)
    expect(isObjectUrlRegistryMessage({ type: 'abort', requestId: 'r-1' })).toBe(false)
    expect(isObjectUrlRegistryMessage(null)).toBe(false)
    expect(isObjectUrlRegistryMessage('nope')).toBe(false)
  })
})
