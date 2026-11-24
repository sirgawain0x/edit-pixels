import AdaptiveSceneDetectionWorker from './adaptive-scene-detection-worker.ts?worker'
import {
  addObjectUrlSyncTarget,
  getObjectUrlRegistrySnapshot,
  SYNC_OBJECT_URL_REGISTRY,
} from '@/infrastructure/browser/object-url-registry'

export function createAdaptiveSceneDetectionWorker(): Worker {
  const worker = new AdaptiveSceneDetectionWorker()
  addObjectUrlSyncTarget(worker)
  const snapshot = getObjectUrlRegistrySnapshot()
  if (snapshot) {
    try {
      worker.postMessage({ type: SYNC_OBJECT_URL_REGISTRY, entries: snapshot.entries })
    } catch {
      // Worker may be terminating; ignore.
    }
  }
  return worker
}
