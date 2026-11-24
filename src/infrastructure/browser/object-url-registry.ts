import type { MediaStorageType } from '@/types/storage'

export interface ObjectUrlSourceMetadata {
  mediaId?: string
  storageType?: MediaStorageType
  fileHandle?: FileSystemFileHandle
  opfsPath?: string
  fileSize?: number
}

export interface DirectObjectUrlSourceMetadata {
  storageType: 'opfs'
  opfsPath: string
  fileSize?: number
}

interface ObjectUrlEntry {
  blob: Blob
  metadata?: ObjectUrlSourceMetadata
}

const entriesByUrl = new Map<string, ObjectUrlEntry>()

export const SYNC_OBJECT_URL_REGISTRY = 'edit-pixels:sync-object-url-registry'
export const ADD_OBJECT_URL = 'edit-pixels:add-object-url'
export const REMOVE_OBJECT_URL = 'edit-pixels:remove-object-url'

const OBJECT_URL_REGISTRY_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  SYNC_OBJECT_URL_REGISTRY,
  ADD_OBJECT_URL,
  REMOVE_OBJECT_URL,
])

/**
 * Inbound worker `message` payloads broadcast by {@link attachObjectUrlRegistrySync}.
 *
 * A worker that opts into the sync shares `self` with the registry listener, so its own handler sees
 * these too. Each such worker guards with this first — a handler that switches on `type` and throws
 * on an unknown one aborts real work when a sync lands (filmstrip extraction was the first casualty).
 */
export function isObjectUrlRegistryMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && OBJECT_URL_REGISTRY_MESSAGE_TYPES.has(type)
}

export interface ObjectUrlRegistrySnapshot {
  entries: Array<{
    url: string
    blob: Blob
    metadata?: Omit<ObjectUrlSourceMetadata, 'fileHandle'>
  }>
}

function isMainThread(): boolean {
  return typeof self !== 'undefined' && typeof document !== 'undefined'
}

function isDedicatedWorkerContext(): boolean {
  return typeof self !== 'undefined' && typeof document === 'undefined'
}

function sanitizeMetadataForWorker(
  metadata?: ObjectUrlSourceMetadata,
): Omit<ObjectUrlSourceMetadata, 'fileHandle'> | undefined {
  if (!metadata) return undefined
  const { fileHandle: _, ...rest } = metadata
  return rest
}

const syncTargets = new Set<MessagePort | Worker>()

export function addObjectUrlSyncTarget(target: MessagePort | Worker): void {
  if (!isMainThread()) return
  syncTargets.add(target)
}

/**
 * Make a worker a registry sync target and keep it one only while it lives.
 *
 * `syncTargets` holds strong references, so a worker that is terminated without unregistering stays
 * in the set: the object is retained and every later `registerObjectUrl` broadcasts to a dead
 * recipient. Wrapping `terminate` is the only hook a raw `Worker` gives us, and it is why this is a
 * helper rather than something each creation site re-implements — the adaptive scene-detection
 * worker created its own and leaked for exactly that reason.
 */
export function attachObjectUrlRegistrySync<T extends Worker>(worker: T): T {
  if (!isMainThread()) return worker
  addObjectUrlSyncTarget(worker)

  const snapshot = getObjectUrlRegistrySnapshot()
  if (snapshot) {
    try {
      worker.postMessage({ type: SYNC_OBJECT_URL_REGISTRY, entries: snapshot.entries })
    } catch {
      // Worker may be terminating; ignore.
    }
  }

  const terminate = worker.terminate.bind(worker)
  worker.terminate = () => {
    removeObjectUrlSyncTarget(worker)
    terminate()
  }
  return worker
}

export function removeObjectUrlSyncTarget(target: MessagePort | Worker): void {
  if (!isMainThread()) return
  syncTargets.delete(target)
}

function broadcastObjectUrlChange(type: string, payload: Record<string, unknown>): void {
  if (!isMainThread()) return
  for (const target of syncTargets) {
    try {
      target.postMessage({ type, ...payload })
    } catch {
      // Worker may be terminating; drop the update.
    }
  }
}

export function registerObjectUrl(
  url: string,
  blob: Blob,
  metadata?: ObjectUrlSourceMetadata,
): void {
  entriesByUrl.set(url, { blob, metadata })
  broadcastObjectUrlChange(ADD_OBJECT_URL, {
    url,
    blob,
    metadata: sanitizeMetadataForWorker(metadata),
  })
}

export function getObjectUrlBlob(url: string): Blob | null {
  return entriesByUrl.get(url)?.blob ?? null
}

export function getObjectUrlSourceMetadata(url: string): ObjectUrlSourceMetadata | null {
  return entriesByUrl.get(url)?.metadata ?? null
}

/**
 * True while `url` is a live object URL tracked by this context. A `blob:` URL
 * that was persisted into a project (or revoked after the media was deleted)
 * is NOT tracked, so this returns false — callers can use it to avoid handing a
 * dead blob URL to `fetch()` / dotlottie and spamming `net::ERR_FILE_NOT_FOUND`.
 */
export function isLiveObjectUrl(url: string): boolean {
  return entriesByUrl.has(url)
}

export function getObjectUrlDirectFileMetadata(url: string): DirectObjectUrlSourceMetadata | null {
  const metadata = entriesByUrl.get(url)?.metadata
  if (!metadata?.opfsPath) {
    return null
  }

  return {
    storageType: 'opfs',
    opfsPath: metadata.opfsPath,
    fileSize: metadata.fileSize,
  }
}

export function unregisterObjectUrl(url: string): void {
  entriesByUrl.delete(url)
  broadcastObjectUrlChange(REMOVE_OBJECT_URL, { url })
}

export function getObjectUrlRegistrySnapshot(): ObjectUrlRegistrySnapshot | null {
  if (!isMainThread()) return null
  const entries: ObjectUrlRegistrySnapshot['entries'] = []
  for (const [url, entry] of entriesByUrl) {
    entries.push({
      url,
      blob: entry.blob,
      metadata: sanitizeMetadataForWorker(entry.metadata),
    })
  }
  return { entries }
}

export function clearObjectUrlRegistry(): void {
  entriesByUrl.clear()
  // Do not clear syncTargets: they are tied to worker lifetime, not registry state.
}

const WORKER_MESSAGE_HANDLERS: Record<string, (data: Record<string, unknown>) => void> = {
  [SYNC_OBJECT_URL_REGISTRY]: applyRegistrySnapshot,
  [ADD_OBJECT_URL]: applyObjectUrlAdd,
  [REMOVE_OBJECT_URL]: applyObjectUrlRemove,
}

function isBlobLike(value: unknown): value is Blob {
  // `File` extends `Blob`, so this covers both.
  return value instanceof Blob
}

function applyRegistrySnapshot(data: Record<string, unknown>): void {
  const entries = data.entries
  if (!Array.isArray(entries)) return
  for (const entry of entries as ObjectUrlRegistrySnapshot['entries']) {
    if (!entry || typeof entry.url !== 'string' || !isBlobLike(entry.blob)) continue
    registerObjectUrl(entry.url, entry.blob, entry.metadata)
  }
}

function applyObjectUrlAdd(data: Record<string, unknown>): void {
  if (typeof data.url !== 'string' || !isBlobLike(data.blob)) return
  registerObjectUrl(
    data.url,
    data.blob,
    sanitizeMetadataForWorker(data.metadata as ObjectUrlSourceMetadata | undefined),
  )
}

function applyObjectUrlRemove(data: Record<string, unknown>): void {
  if (typeof data.url !== 'string') return
  unregisterObjectUrl(data.url)
}

if (isDedicatedWorkerContext() && typeof self.addEventListener === 'function') {
  self.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data as Record<string, unknown> | undefined
    if (!data || typeof data !== 'object') return
    WORKER_MESSAGE_HANDLERS[String(data.type)]?.(data)
  })
}
