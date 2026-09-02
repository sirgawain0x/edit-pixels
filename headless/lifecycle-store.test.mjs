import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  acquireWriterLock,
  atomicWriteFile,
  createProjectResource,
  downloadMediaUrl,
  getProjectResource,
  listProjectResources,
  resolveHeadlessDir,
  revisionOf,
  saveProjectResource,
  stageLocalMedia,
} from './lib/lifecycle-store.mjs'

const tempWorkspace = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pixels-lifecycle-'))
const project = (id = 'p1') => ({
  id,
  name: 'One',
  description: '',
  createdAt: 1,
  updatedAt: 1,
  duration: 0,
  schemaVersion: 14,
  metadata: { width: 1920, height: 1080, fps: 30 },
})

test('project writes return exact-byte revisions and reject stale saves', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const created = await createProjectResource(root, project())
  const bytes = fs.readFileSync(path.join(root, 'projects', 'p1', 'project.json'))
  assert.equal(created.revision, revisionOf(bytes))
  assert.equal((await getProjectResource(root, 'p1')).project.name, 'One')
  const saved = await saveProjectResource(
    root,
    'p1',
    { ...project(), name: 'Two' },
    { expectedRevision: created.revision },
  )
  assert.equal(saved.project.name, 'Two')
  await assert.rejects(
    () => saveProjectResource(root, 'p1', project(), { expectedRevision: created.revision }),
    (error) => error.code === 'REVISION_CONFLICT',
  )
  assert.deepEqual(
    (await listProjectResources(root)).map((entry) => entry.id),
    ['p1'],
  )
})

test('atomic pre-commit failure preserves live bytes and removes temp files', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const target = path.join(root, 'value.json')
  fs.writeFileSync(target, 'old')
  await assert.rejects(() =>
    atomicWriteFile(target, Buffer.from('new'), {
      beforeCommit: () => {
        throw new Error('interrupt')
      },
    }),
  )
  assert.equal(fs.readFileSync(target, 'utf8'), 'old')
  assert.deepEqual(fs.readdirSync(root), ['value.json'])
})

test('exclusive writer lock refuses a second writer', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const release = await acquireWriterLock(root)
  await assert.rejects(
    () => acquireWriterLock(root),
    (error) => error.code === 'WORKSPACE_LOCKED',
  )
  await assert.rejects(
    () => acquireWriterLock(root, { breakLock: true }),
    (error) => error.code === 'WORKSPACE_LOCKED',
  )
  await release()
  const releaseAgain = await acquireWriterLock(root)
  await releaseAgain()
})

test('writer lock automatically recovers an old lock with a confirmed-dead local PID', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const lockDir = path.join(root, '.pixels-headless')
  fs.mkdirSync(lockDir, { recursive: true })
  fs.writeFileSync(
    path.join(lockDir, 'writer.lock'),
    JSON.stringify({ pid: 2_147_483_647, token: 'stale', createdAt: 0 }),
  )
  const release = await acquireWriterLock(root, { staleGraceMs: 1 })
  await release()
})

test('resolveHeadlessDir migrates legacy .freecut-headless to .pixels-headless', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const legacy = path.join(root, '.freecut-headless')
  fs.mkdirSync(legacy, { recursive: true })
  fs.writeFileSync(
    path.join(legacy, 'writer.lock'),
    JSON.stringify({ pid: process.pid, token: 'legacy', createdAt: Date.now() }),
  )
  const resolved = await resolveHeadlessDir(root)
  assert.equal(resolved, path.join(root, '.pixels-headless'))
  assert.equal(fs.existsSync(legacy), false)
  assert.equal(fs.existsSync(path.join(resolved, 'writer.lock')), true)
})

test('media staging streams supported files and rejects traversal ids', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'tiny.png')
  fs.writeFileSync(source, Buffer.from([1, 2, 3]))
  const staged = await stageLocalMedia(root, source, 'media_1')
  assert.deepEqual(fs.readFileSync(staged.target), Buffer.from([1, 2, 3]))
  await assert.rejects(
    () => stageLocalMedia(root, source, '../escape'),
    (error) => error.code === 'INVALID_ID',
  )
})

function mockFetchResponse({ contentType, bytes, url }) {
  return {
    ok: true,
    url,
    headers: {
      get(name) {
        if (name === 'content-type') return contentType
        if (name === 'content-length') return String(bytes.length)
        return null
      },
    },
    body: {
      getReader() {
        let sent = false
        return {
          async read() {
            if (sent) return { done: true }
            sent = true
            return { done: false, value: bytes }
          },
        }
      },
    },
  }
}

test('downloadMediaUrl prefers canonical extension for shared MIME types', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = async () => mockFetchResponse({ contentType: 'audio/ogg', bytes: Buffer.from([1, 2]) })

  const withoutPathExt = await downloadMediaUrl('https://example.com/audio')
  assert.equal(withoutPathExt.ext, '.ogg')

  globalThis.fetch = async () => mockFetchResponse({ contentType: 'audio/ogg', bytes: Buffer.from([1, 2]) })
  const withPathExt = await downloadMediaUrl('https://example.com/voice.opus')
  assert.equal(withPathExt.ext, '.opus')

  await fs.promises.rm(withoutPathExt.tmpDir, { recursive: true, force: true })
  await fs.promises.rm(withPathExt.tmpDir, { recursive: true, force: true })
})

test('downloadMediaUrl uses final URL and Content-Type after redirects', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = async () =>
    mockFetchResponse({
      contentType: 'audio/ogg',
      bytes: Buffer.from([1, 2]),
      url: 'https://cdn.example.com/voice.ogg',
    })
  const redirected = await downloadMediaUrl('https://example.com/download.html')
  assert.equal(redirected.ext, '.ogg')

  globalThis.fetch = async () =>
    mockFetchResponse({
      contentType: 'audio/ogg',
      bytes: Buffer.from([1, 2]),
      url: 'https://example.com/download.html',
    })
  const misleadingPath = await downloadMediaUrl('https://example.com/download.html')
  assert.equal(misleadingPath.ext, '.ogg')

  await fs.promises.rm(redirected.tmpDir, { recursive: true, force: true })
  await fs.promises.rm(misleadingPath.tmpDir, { recursive: true, force: true })
})
