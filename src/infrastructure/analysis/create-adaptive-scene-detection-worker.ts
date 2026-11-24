import AdaptiveSceneDetectionWorker from './adaptive-scene-detection-worker.ts?worker'
import { attachObjectUrlRegistrySync } from '@/infrastructure/browser/object-url-registry'

/**
 * The scene detector decodes the source itself (`createMediabunnyInputSource`), so it needs the
 * object-URL registry the main thread holds. Attach it through the shared helper: registering here
 * by hand left the terminated worker in the sync-target set, retaining it and broadcasting to a
 * dead recipient for the rest of the session.
 */
export function createAdaptiveSceneDetectionWorker(): Worker {
  return attachObjectUrlRegistrySync(new AdaptiveSceneDetectionWorker())
}
