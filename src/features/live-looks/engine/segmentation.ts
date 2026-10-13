import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'
import {
  getMediapipeWasmBaseUrl,
  MEDIAPIPE_TASKS_VISION_VERSION,
  SELFIE_SEGMENTER_MODEL_URL,
} from '../config/mediapipe-assets'

let segmenterPromise: Promise<ImageSegmenter> | null = null

export function loadImageSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      try {
        const wasmFileset = await FilesetResolver.forVisionTasks(getMediapipeWasmBaseUrl())
        return await ImageSegmenter.createFromOptions(wasmFileset, {
          baseOptions: {
            modelAssetPath: SELFIE_SEGMENTER_MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(
          `MediaPipe tasks-vision ${MEDIAPIPE_TASKS_VISION_VERSION} failed to load: ${detail}`,
        )
      }
    })().catch((error) => {
      segmenterPromise = null
      throw error
    })
  }
  return segmenterPromise
}

export async function disposeImageSegmenter(): Promise<void> {
  if (!segmenterPromise) return
  const segmenter = await segmenterPromise
  segmenter.close()
  segmenterPromise = null
}
