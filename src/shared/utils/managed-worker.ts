import {
  addObjectUrlSyncTarget,
  getObjectUrlRegistrySnapshot,
  removeObjectUrlSyncTarget,
  SYNC_OBJECT_URL_REGISTRY,
} from '@/infrastructure/browser/object-url-registry'

export interface ManagedWorker<TWorker extends Worker = Worker> {
  getWorker(): TWorker
  peekWorker(): TWorker | null
  terminate(): void
}

export interface ManagedWorkerOptions<TWorker extends Worker = Worker> {
  createWorker: () => TWorker
  setupWorker?: (worker: TWorker) => void | (() => void)
}

export interface RejectablePendingRequest {
  reject(error: Error): void
}

export function rejectAndDeletePendingRequests<TPending extends RejectablePendingRequest>(
  pendingRequests: Map<string, TPending>,
  error: Error,
): void {
  pendingRequests.forEach((pending) => {
    pending.reject(error)
  })
  pendingRequests.clear()
}

export function createManagedWorker<TWorker extends Worker = Worker>(
  options: ManagedWorkerOptions<TWorker>,
): ManagedWorker<TWorker> {
  let worker: TWorker | null = null
  let cleanup: (() => void) | null = null

  function syncObjectUrlRegistry(targetWorker: TWorker): void {
    const snapshot = getObjectUrlRegistrySnapshot()
    if (!snapshot) return
    try {
      targetWorker.postMessage({ type: SYNC_OBJECT_URL_REGISTRY, entries: snapshot.entries })
    } catch {
      // Worker may be terminating; ignore.
    }
  }

  function instantiateWorker(): TWorker {
    const nextWorker = options.createWorker()
    addObjectUrlSyncTarget(nextWorker)
    syncObjectUrlRegistry(nextWorker)
    cleanup = options.setupWorker?.(nextWorker) ?? null
    worker = nextWorker
    return nextWorker
  }

  function getWorker(): TWorker {
    return worker ?? instantiateWorker()
  }

  function peekWorker(): TWorker | null {
    return worker
  }

  function terminate(): void {
    if (!worker) {
      return
    }

    const activeWorker = worker
    worker = null

    try {
      cleanup?.()
    } finally {
      cleanup = null
      removeObjectUrlSyncTarget(activeWorker)
      activeWorker.terminate()
    }
  }

  return {
    getWorker,
    peekWorker,
    terminate,
  }
}
