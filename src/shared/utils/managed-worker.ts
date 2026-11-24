import {
  attachObjectUrlRegistrySync,
  removeObjectUrlSyncTarget,
} from '@/infrastructure/browser/object-url-registry'

export interface ManagedWorker<TWorker extends Worker = Worker> {
  getWorker(): TWorker
  peekWorker(): TWorker | null
  terminate(): void
}

export interface ManagedWorkerOptions<TWorker extends Worker = Worker> {
  createWorker: () => TWorker
  setupWorker?: (worker: TWorker) => void | (() => void)
  /**
   * Give this worker the object-URL registry, so it can decode `blob:` sources with mediabunny.
   *
   * Opt-in on purpose: the sync is a `postMessage` the worker also sees, and a handler that throws
   * on an unknown `type` aborts whatever it was doing. Set this only for workers that decode blob
   * URLs, and guard their handler with `isObjectUrlRegistryMessage`.
   */
  syncObjectUrlRegistry?: boolean
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

  function instantiateWorker(): TWorker {
    const nextWorker = options.createWorker()
    if (options.syncObjectUrlRegistry) attachObjectUrlRegistrySync(nextWorker)
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
