import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

/**
 * Every worker that decodes `blob:` sources must be given the object-URL registry.
 *
 * `createMediabunnyInputSource` throws "Blob URL source is not registered in this worker" when it
 * gets a `blob:` URL the worker has never seen. Because the sync is opt-in, forgetting the flag is
 * silent at build time and only shows up as playback with no sound — which is exactly how the
 * playback-window lane went dead while video clip audio kept working.
 *
 * The check is **per spawn site**, not per file: `audio-decode-cache.ts` runs two managers over the
 * same worker script, and a flag on one of them hides an omission on the other. That masking is what
 * let the regression through the first version of this test.
 */

const SRC_ROOT = path.resolve(import.meta.dirname, '../..')

/** Modules that need the registry to read their input. */
const DECODES_BLOB_SOURCES = ['createMediabunnyInputSource', 'getObjectUrlBlob']

const MANAGED_CALL = /\b(createManagedWorker|createManagedWorkerPool)\s*\(/g
const WORKER_URL = /new URL\(\s*'([^']+\.ts)'\s*,\s*import\.meta\.url\s*\)/g

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

/** Balanced-paren slice starting at an opening `(`. */
function extractCall(source: string, openParenIndex: number): string {
  let depth = 0
  for (let i = openParenIndex; i < source.length; i++) {
    const char = source[i]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return source.slice(openParenIndex, i + 1)
    }
  }
  return source.slice(openParenIndex)
}

function decodesBlobSources(modulePath: string): boolean {
  if (!fs.existsSync(modulePath)) return false
  const source = fs.readFileSync(modulePath, 'utf8')
  return DECODES_BLOB_SOURCES.some((needle) => source.includes(needle))
}

interface ManagedCallSite {
  file: string
  line: number
  call: string
  /** Every worker module this file can spawn, resolved. */
  workerModules: string[]
}

function findManagedCallSites(file: string): ManagedCallSite[] {
  const source = fs.readFileSync(file, 'utf8')
  const workerModules = [...source.matchAll(WORKER_URL)].map((match) =>
    path.resolve(path.dirname(file), match[1]!),
  )

  return [...source.matchAll(MANAGED_CALL)].map((match) => {
    const openParen = (match.index ?? 0) + match[0].length - 1
    const line = source.slice(0, match.index ?? 0).split('\n').length
    return { file, line, call: extractCall(source, openParen), workerModules }
  })
}

describe('worker registry-sync coverage', () => {
  const files = walk(SRC_ROOT)
  const sites = files.flatMap(findManagedCallSites)

  const blobDecoding = sites.filter((site) =>
    site.workerModules.some((module) => decodesBlobSources(module)),
  )

  it('finds the managed call sites it is meant to police', () => {
    // If this ever drops to zero the check silently stops protecting anything.
    expect(sites.length).toBeGreaterThanOrEqual(6)
    expect(blobDecoding.length).toBeGreaterThanOrEqual(3)
  })

  it('gives the registry to every managed worker that decodes blob sources', () => {
    const missing = blobDecoding
      .filter((site) => !site.call.includes('syncObjectUrlRegistry: true'))
      .map((site) => `${path.relative(SRC_ROOT, site.file)}:${site.line}`)

    expect(missing).toEqual([])
  })

  it('does not hand the registry to managed workers that never read it', () => {
    // The sync is a `postMessage` the worker also sees; sending it to a handler that throws on an
    // unknown `type` aborts real work. Only blob-decoding workers may opt in.
    const unnecessary = sites
      .filter((site) => !site.workerModules.some((module) => decodesBlobSources(module)))
      .filter((site) => site.call.includes('syncObjectUrlRegistry: true'))
      .map((site) => `${path.relative(SRC_ROOT, site.file)}:${site.line}`)

    expect(unnecessary).toEqual([])
  })

  it('wraps raw spawns of blob-decoding workers with the registry helper', () => {
    // Managed helpers opt in through the flag; a raw `new Worker(...)` has to be wrapped instead.
    const rawSpawns = files.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8')
      const sites: string[] = []
      for (const match of source.matchAll(WORKER_URL)) {
        const modulePath = path.resolve(path.dirname(file), match[1]!)
        if (!decodesBlobSources(modulePath)) continue
        // Managed call sites are covered by the flag check above.
        if (source.includes('createManagedWorker') || source.includes('createManagedWorker(')) {
          if (source.slice(0, match.index ?? 0).lastIndexOf('createManagedWorker') > -1) continue
        }
        const index = match.index ?? 0
        const excerpt = source.slice(Math.max(0, index - 120), index)
        if (excerpt.includes('attachObjectUrlRegistrySync(')) continue
        // The worker URL may be created inside a factory that a managed call consumes.
        if (excerpt.includes('createWorker') || /function create\w*Worker/.test(excerpt)) continue
        sites.push(`${path.relative(SRC_ROOT, file)} -> ${path.basename(modulePath)}`)
      }
      return sites
    })

    expect(rawSpawns).toEqual([])
  })
})
