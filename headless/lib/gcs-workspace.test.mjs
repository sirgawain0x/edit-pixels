import assert from 'node:assert/strict'
import test from 'node:test'
import { parseGsPrefix, buildWorkspaceGsPrefix } from './gcs-workspace.mjs'

test('parseGsPrefix extracts bucket and prefix', () => {
  assert.deepEqual(parseGsPrefix('gs://my-bucket/workspaces/director/s1'), {
    bucket: 'my-bucket',
    prefix: 'workspaces/director/s1',
  })
})

test('buildWorkspaceGsPrefix formats session path', () => {
  assert.equal(
    buildWorkspaceGsPrefix('creative-ai-491118-creative-pixels-renders', 'director', 'cd_abc'),
    'gs://creative-ai-491118-creative-pixels-renders/workspaces/director/cd_abc',
  )
})

test('parseGsPrefix rejects invalid input', () => {
  assert.throws(() => parseGsPrefix('https://example.com'), /gs_prefix/)
})
