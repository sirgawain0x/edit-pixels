#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WASM_SRC = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const WASM_DEST = path.join(ROOT, 'public', 'live-looks', 'mediapipe-wasm')
const MODEL_DEST = path.join(ROOT, 'public', 'live-looks', 'models', 'selfie_segmenter_float16.tflite')
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite'

function copyWasmAssets() {
  if (!fs.existsSync(WASM_SRC)) {
    console.warn(
      '[sync-live-looks-mediapipe-assets] @mediapipe/tasks-vision not installed; skipping WASM copy.',
    )
    return
  }

  fs.mkdirSync(WASM_DEST, { recursive: true })
  for (const entry of fs.readdirSync(WASM_SRC)) {
    const from = path.join(WASM_SRC, entry)
    const to = path.join(WASM_DEST, entry)
    if (!fs.statSync(from).isFile()) continue
    fs.copyFileSync(from, to)
  }
}

async function ensureModelAsset() {
  if (fs.existsSync(MODEL_DEST)) {
    return
  }

  fs.mkdirSync(path.dirname(MODEL_DEST), { recursive: true })
  const response = await fetch(MODEL_URL)
  if (!response.ok) {
    throw new Error(`Failed to download selfie segmenter model: ${response.status}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(MODEL_DEST, buffer)
}

async function main() {
  copyWasmAssets()
  await ensureModelAsset()
}

main().catch((error) => {
  console.error('[sync-live-looks-mediapipe-assets]', error)
  process.exit(1)
})
