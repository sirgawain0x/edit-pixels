import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  collectApiImportViolations,
  isExtensionlessRelativeImport,
} from './check-api-src-imports.mjs'

test('isExtensionlessRelativeImport flags extensionless relative specifiers', () => {
  assert.equal(isExtensionlessRelativeImport('./foo.js'), false)
  assert.equal(isExtensionlessRelativeImport('./foo.json'), false)
  assert.equal(isExtensionlessRelativeImport('node:fs'), false)
  assert.equal(isExtensionlessRelativeImport('./foo'), true)
  assert.equal(isExtensionlessRelativeImport('../bar/types'), true)
})

test('collectApiImportViolations catches extensionless imports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-esm-import-check-'))
  try {
    fs.writeFileSync(
      path.join(dir, 'bad.ts'),
      "import { foo } from './missing-extension'\n",
      'utf8'
    )
    const violations = collectApiImportViolations(dir)
    const extensionless = violations.filter((v) => v.kind === 'extensionless')
    assert.equal(extensionless.length, 1)
    assert.equal(extensionless[0]?.specifier, './missing-extension')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
