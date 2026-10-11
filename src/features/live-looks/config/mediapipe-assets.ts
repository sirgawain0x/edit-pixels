/** Pinned to the exact `@mediapipe/tasks-vision` dependency version in package.json. */
export const MEDIAPIPE_TASKS_VISION_VERSION = '1.1.0'

function liveLooksAssetUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL.slice(0, -1)
    : import.meta.env.BASE_URL
  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`
  return `${base}${path}`
}

/**
 * WASM binaries for MediaPipe Tasks Vision, copied to `public/live-looks/mediapipe-wasm/`
 * by `scripts/sync-live-looks-mediapipe-assets.mjs` (postinstall + prebuild).
 */
export function getMediapipeWasmBaseUrl(): string {
  return liveLooksAssetUrl('/live-looks/mediapipe-wasm')
}

/**
 * Selfie segmenter model (float16), revision 1 (Apache-2.0).
 * Vendored at `public/live-looks/models/selfie_segmenter_float16.tflite`.
 */
export const SELFIE_SEGMENTER_MODEL_URL = liveLooksAssetUrl(
  '/live-looks/models/selfie_segmenter_float16.tflite',
)
