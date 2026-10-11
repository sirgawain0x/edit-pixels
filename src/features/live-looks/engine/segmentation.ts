import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'
import {
  getMediapipeWasmBaseUrl,
  SELFIE_SEGMENTER_MODEL_URL,
} from '../config/mediapipe-assets'

let segmenterPromise: Promise<ImageSegmenter> | null = null

export function loadImageSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const wasmFileset = await FilesetResolver.forVisionTasks(getMediapipeWasmBaseUrl())
      return ImageSegmenter.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: SELFIE_SEGMENTER_MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      })
    })()
  }
  return segmenterPromise
}

export async function disposeImageSegmenter(): Promise<void> {
  if (!segmenterPromise) return
  const segmenter = await segmenterPromise
  segmenter.close()
  segmenterPromise = null
}
