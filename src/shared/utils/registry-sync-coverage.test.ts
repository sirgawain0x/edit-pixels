import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

/**
 * Which spawn sites must give their worker the object-URL registry, and which must not.
 *
 * `createMediabunnyInputSource` throws "Blob URL source is not registered in this worker" for a
 * `blob:` URL the worker has never seen, so any worker that resolves those sources has to be a sync
 * target. Getting this wrong is silent until playback has no sound or a render draws no images —
 * which happened twice while the sync was opt-in:
 *
 * - the playback-window audio lane was missed while the full-decode lane was opted in;
 * - the export render worker was missed entirely, so `ClientRenderEngine: Failed to load image` and
 *   `VideoFrameExtractor: Failed to initialize` fired on every export.
 *
 * The list is curated rather than inferred. Inferring it from imports was tried and is too noisy:
 * workers that take a `File` (media-processor, opfs, proxy, upscale, frame interpolation)
 * transitively touch the same module without ever resolving a `blob:` URL. So the rule is written
 * down here, and enforced in both directions.
 */

const SRC_ROOT = path.resolve(import.meta.dirname, '../..')

/** Spawn sites whose worker resolves `blob:` URLs, with how many spawn paths each must cover. */
const MUST_SYNC: ReadonlyArray<{ file: string; lanes: number; raw?: boolean }> = [
  // Two lanes over the same script: background full decodes and the playback-window lane.
  { file: 'runtime/composition-runtime/utils/audio-decode-cache.ts', lanes: 2 },
  { file: 'features/timeline/services/filmstrip-cache.ts', lanes: 1 },
  { file: 'features/timeline/services/waveform-cache.ts', lanes: 1 },
  { file: 'features/export/utils/render-pipeline.ts', lanes: 1 },
  // Raw spawns, so they opt in by wrapping rather than by flag.
  { file: 'features/preview/utils/decoder-prewarm.ts', lanes: 1, raw: true },
  {
    file: 'infrastructure/analysis/create-adaptive-scene-detection-worker.ts',
    lanes: 1,
    raw: true,
  },
]

// The call may be generic: `createManagedWorker<Worker>({ ... })`.
const MANAGED_CALL = /\b(createManagedWorker|createManagedWorkerPool)\s*(?:<[^<>]*>)?\s*\(/g
const WORKER_HELPER = 'attachObjectUrlRegistrySync'

function read(relative: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relative), 'utf8')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue
    out.push(full)
  }
  return out
}

function countManagedCalls(source: string): number {
  let count = 0
  for (const _match of source.matchAll(MANAGED_CALL)) count += 1
  return count
}

describe('worker registry-sync coverage', () => {
  for (const entry of MUST_SYNC) {
    it(`${entry.file} hands the registry to its worker`, () => {
      const source = read(entry.file)

      if (entry.raw) {
        expect(source).toContain(WORKER_HELPER)
        return
      }

      // Count the flag rather than merely finding it: two spawn paths in one file means two flags,
      // and a flag on one lane silently covering for the other is the bug this test exists for.
      const flagged = (source.match(/syncObjectUrlRegistry:\s*true/g) ?? []).length
      expect(flagged).toBe(entry.lanes)
      expect(countManagedCalls(source)).toBeGreaterThanOrEqual(entry.lanes)
    })
  }

  it('does not hand the registry to workers that never resolve blob URLs', () => {
    // The sync is a `postMessage` the worker also sees; a handler that throws on an unknown `type`
    // aborts real work. Workers that take a `File` must stay out of it.
    const offenders = walk(SRC_ROOT)
      .filter(
        (file) => !file.endsWith('managed-worker.ts') && !file.endsWith('managed-worker-pool.ts'),
      )
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8')
        if (!source.includes('syncObjectUrlRegistry: true')) return false
        const relative = path.relative(SRC_ROOT, file)
        return !MUST_SYNC.some((entry) => entry.file === relative)
      })
      .map((file) => path.relative(SRC_ROOT, file))

    expect(offenders).toEqual([])
  })
})
