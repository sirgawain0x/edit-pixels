/**
 * Hydrate / dehydrate Pixels headless workspace to/from GCS.
 *
 * Layout: gs://{bucket}/workspaces/{tenant}/{session}/ mirrors local workspace:
 *   projects/, media/, .pixels-headless/, index.json, etc.
 */

import fs from 'node:fs'
import path from 'node:path'
import { Storage } from '@google-cloud/storage'

const SKIP_UPLOAD = new Set(['writer.lock'])

/** @returns {{ bucket: string, prefix: string }} prefix has no leading/trailing slash */
export function parseGsPrefix(gsPrefix) {
  const match = /^gs:\/\/([^/]+)\/?(.*)$/.exec(gsPrefix.trim())
  if (!match) {
    throw new Error('gs_prefix must be gs://bucket/path')
  }
  const bucket = match[1]
  const prefix = (match[2] || '').replace(/\/$/, '')
  return { bucket, prefix }
}

export function buildWorkspaceGsPrefix(bucket, tenantId, sessionId) {
  const tenant = tenantId.trim() || 'director'
  const session = sessionId.trim()
  if (!session) throw new Error('session_id is required')
  return `gs://${bucket}/workspaces/${tenant}/${session}`
}

function localPathForObject(workspaceRoot, objectName, prefix) {
  const relative = prefix ? objectName.slice(prefix.length + 1) : objectName
  if (!relative || relative.includes('..')) {
    throw new Error(`Unsafe object path: ${objectName}`)
  }
  return path.join(workspaceRoot, relative)
}

// fallow-ignore-next-line complexity
function shouldSyncRelative(relativePath) {
  if (!relativePath || relativePath.includes('..')) return false
  if (relativePath.endsWith('/writer.lock')) return false
  if (SKIP_UPLOAD.has(path.basename(relativePath))) return false
  return true
}

// fallow-ignore-next-line complexity
async function walkFiles(dir, baseDir, files = []) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkFiles(full, baseDir, files)
    } else if (entry.isFile()) {
      const relative = path.relative(baseDir, full).split(path.sep).join('/')
      if (shouldSyncRelative(relative)) files.push({ full, relative })
    }
  }
  return files
}

/**
 * Download GCS objects under gs_prefix into workspaceRoot.
 * @param {{ workspaceRoot: string, gsPrefix: string, storage?: Storage }} opts
 */
export async function hydrateWorkspace({ workspaceRoot, gsPrefix, storage = new Storage() }) {
  const { bucket, prefix } = parseGsPrefix(gsPrefix)
  const bucketRef = storage.bucket(bucket)
  const [files] = await bucketRef.getFiles({ prefix: prefix ? `${prefix}/` : '' })
  let downloaded = 0

  for (const file of files) {
    if (file.name.endsWith('/')) continue
    const localPath = localPathForObject(workspaceRoot, file.name, prefix)
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true })
    await file.download({ destination: localPath })
    downloaded++
  }

  return { direction: 'hydrate', gs_prefix: gsPrefix, files: downloaded }
}

/**
 * Upload workspace files under workspaceRoot to gs_prefix.
 * @param {{ workspaceRoot: string, gsPrefix: string, storage?: Storage }} opts
 */
export async function dehydrateWorkspace({ workspaceRoot, gsPrefix, storage = new Storage() }) {
  const { bucket, prefix } = parseGsPrefix(gsPrefix)
  const bucketRef = storage.bucket(bucket)
  const localFiles = await walkFiles(workspaceRoot, workspaceRoot)

  for (const { full, relative } of localFiles) {
    const objectName = prefix ? `${prefix}/${relative}` : relative
    await bucketRef.upload(full, {
      destination: objectName,
      resumable: false,
      metadata: { cacheControl: 'private, max-age=0' },
    })
  }

  return { direction: 'dehydrate', gs_prefix: gsPrefix, files: localFiles.length }
}
