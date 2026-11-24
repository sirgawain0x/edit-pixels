import { isObjectUrlRegistryMessage } from '@/infrastructure/browser/object-url-registry'
import type { AdaptiveSceneWorkerRequest } from './adaptive-scene-detection-worker.types'

/**
 * Whether an inbound worker message is an analysis request.
 *
 * This worker shares `self` with the object-URL registry listener, so it also receives registry
 * sync broadcasts. An unguarded handler treated those as work: the message has no `requestId`, the
 * worker marked itself busy, and the analysis request that followed was rejected with
 * "Adaptive scene analysis worker is already busy".
 */
export function isAnalysisRequest(value: unknown): value is AdaptiveSceneWorkerRequest {
  if (isObjectUrlRegistryMessage(value)) return false
  if (!value || typeof value !== 'object') return false
  const candidate = value as { requestId?: unknown; type?: unknown }
  if (typeof candidate.requestId !== 'string') return false
  // `abort` carries only a requestId; a run additionally carries a source URL.
  return (
    candidate.type === 'abort' || typeof (value as { sourceUrl?: unknown }).sourceUrl === 'string'
  )
}
