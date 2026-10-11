/** Pinned to the exact `@mediapipe/tasks-vision` dependency version in package.json. */
export const MEDIAPIPE_TASKS_VISION_VERSION = '1.1.0'

/**
 * WASM binaries for MediaPipe Tasks Vision.
 * Served from jsDelivr at a pinned version today; copy `node_modules/@mediapipe/tasks-vision/wasm`
 * into `public/live-looks/mediapipe-wasm/` to self-host (recommended for strict CSP / no third-party CDN).
 */
export function getMediapipeWasmBaseUrl(): string {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`
}

/** Selfie segmenter model (float16), revision 1 — pinned URL, not `latest`. */
export const SELFIE_SEGMENTER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite'
