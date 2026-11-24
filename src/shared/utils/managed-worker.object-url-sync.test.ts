// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ADD_OBJECT_URL,
  REMOVE_OBJECT_URL,
  SYNC_OBJECT_URL_REGISTRY,
  attachObjectUrlRegistrySync,
  clearObjectUrlRegistry,
  registerObjectUrl,
  removeObjectUrlSyncTarget,
  unregisterObjectUrl,
} from '@/infrastructure/browser/object-url-registry'
import { createManagedWorker } from './managed-worker'
import { createManagedWorkerPool } from './managed-worker-pool'

/**
 * A worker created *after* a blob exists must receive it.
 *
 * `createMediabunnyInputSource` throws "Blob URL source is not registered in this worker" for a
 * `blob:` URL the worker has not been told about, and a `blob:` URL is a main-thread capability.
 * The registration therefore has to be replayed on worker start and kept current while it lives —
 * a start-up snapshot alone goes stale as soon as the next media is imported.
 *
 * These run under jsdom on purpose: `isMainThread()` is `document !== undefined`, so the `node`
 * environment used by `managed-worker.test.ts` makes every one of these calls a silent no-op and
 * the wiring untestable.
 */

type MockWorker = {
  terminate: ReturnType<typeof vi.fn<() => void>>
  postMessage: ReturnType<typeof vi.fn<(message: unknown) => void>>
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

function createMockWorker(): MockWorker {
  return {
    terminate: vi.fn<() => void>(),
    postMessage: vi.fn<(message: unknown) => void>(),
    onmessage: null,
    onerror: null,
  }
}

function messagesOf(worker: MockWorker): Array<Record<string, unknown>> {
  return worker.postMessage.mock.calls.map(([message]) => message as Record<string, unknown>)
}

describe('managed worker object-URL sync', () => {
  beforeEach(() => {
    clearObjectUrlRegistry()
  })

  afterEach(() => {
    clearObjectUrlRegistry()
  })

  it('replays the registry to a worker that starts after the blob exists', () => {
    const blob = new Blob(['already-here'])
    registerObjectUrl('blob:existing', blob, { mediaId: 'media-existing' })

    const worker = createMockWorker()
    createManagedWorker({
      createWorker: () => worker as unknown as Worker,
      syncObjectUrlRegistry: true,
    }).getWorker()

    const snapshot = messagesOf(worker).find((m) => m.type === SYNC_OBJECT_URL_REGISTRY)
    expect(snapshot).toBeDefined()
    expect(snapshot!.entries).toEqual([
      { url: 'blob:existing', blob, metadata: { mediaId: 'media-existing' } },
    ])
  })

  it('keeps the worker current for blobs created after it started', () => {
    const worker = createMockWorker()
    createManagedWorker({
      createWorker: () => worker as unknown as Worker,
      syncObjectUrlRegistry: true,
    }).getWorker()

    const laterBlob = new Blob(['imported-later'])
    registerObjectUrl('blob:later', laterBlob, { mediaId: 'media-later' })

    const added = messagesOf(worker).find(
      (m) => m.type === ADD_OBJECT_URL && m.url === 'blob:later',
    )
    expect(added).toBeDefined()
    expect(added!.blob).toBe(laterBlob)

    unregisterObjectUrl('blob:later')

    expect(
      messagesOf(worker).some((m) => m.type === REMOVE_OBJECT_URL && m.url === 'blob:later'),
    ).toBe(true)
  })

  it('replays the registry to pooled workers too', () => {
    // The pool duplicates the managed-worker wiring, so it needs its own pin: a pooled worker is
    // created on demand and would otherwise miss every blob registered before it was acquired.
    const blob = new Blob(['pooled'])
    registerObjectUrl('blob:pooled', blob, { mediaId: 'media-pooled' })

    const worker = createMockWorker()
    const pool = createManagedWorkerPool({
      createWorker: () => worker as unknown as Worker,
      syncObjectUrlRegistry: true,
    })
    pool.acquireWorker()

    const snapshot = messagesOf(worker).find((m) => m.type === SYNC_OBJECT_URL_REGISTRY)
    expect(snapshot?.entries).toEqual([
      { url: 'blob:pooled', blob, metadata: { mediaId: 'media-pooled' } },
    ])
  })

  it('stops syncing a worker once it is terminated', () => {
    const worker = createMockWorker()
    const managedWorker = createManagedWorker({ createWorker: () => worker as unknown as Worker })

    managedWorker.getWorker()
    managedWorker.terminate()
    worker.postMessage.mockClear()

    registerObjectUrl('blob:after-terminate', new Blob(['x']), { mediaId: 'media-after' })

    expect(messagesOf(worker)).toEqual([])
  })

  it('unregisters a raw worker that only wraps terminate', () => {
    // The adaptive scene-detection worker is created directly, not through a managed wrapper: its
    // registration used to outlive termination, retaining the worker and broadcasting to a dead
    // recipient for the rest of the session.
    const worker = createMockWorker()
    // `attachObjectUrlRegistrySync` wraps `terminate`, so the original spy is what proves the real
    // worker was torn down after the bookkeeping ran.
    const terminateOriginal = worker.terminate as ReturnType<typeof vi.fn>
    attachObjectUrlRegistrySync(worker as unknown as Worker)

    registerObjectUrl('blob:before-terminate', new Blob(['a']), { mediaId: 'media-before' })
    expect(messagesOf(worker).some((m) => m.type === ADD_OBJECT_URL)).toBe(true)

    worker.terminate()
    worker.postMessage.mockClear()

    registerObjectUrl('blob:after-terminate', new Blob(['b']), { mediaId: 'media-after' })

    expect(messagesOf(worker)).toEqual([])
    expect(terminateOriginal).toHaveBeenCalledTimes(1)
  })

  it('drops a sync target on explicit removal', () => {
    const worker = createMockWorker()
    createManagedWorker({ createWorker: () => worker as unknown as Worker }).getWorker()
    worker.postMessage.mockClear()

    removeObjectUrlSyncTarget(worker as unknown as Worker)
    registerObjectUrl('blob:after-removal', new Blob(['y']), { mediaId: 'media-removal' })

    expect(messagesOf(worker)).toEqual([])
  })
})

describe('object-URL sync is opt-in', () => {
  beforeEach(() => {
    clearObjectUrlRegistry()
  })

  it('leaves a worker that did not ask for it untouched', () => {
    // Blanket syncing broke workers whose handler throws on an unknown `type`: filmstrip extraction
    // aborted and fell back to the video element. Only blob-decoding workers opt in.
    registerObjectUrl('blob:existing', new Blob(['a']), { mediaId: 'media-existing' })

    const worker = createMockWorker()
    createManagedWorker({ createWorker: () => worker as unknown as Worker }).getWorker()

    expect(messagesOf(worker)).toEqual([])
  })

  it('leaves pooled workers that did not ask for it untouched', () => {
    registerObjectUrl('blob:existing', new Blob(['a']), { mediaId: 'media-existing' })

    const worker = createMockWorker()
    createManagedWorkerPool({ createWorker: () => worker as unknown as Worker }).acquireWorker()

    expect(messagesOf(worker)).toEqual([])
  })
})
