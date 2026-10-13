#!/usr/bin/env node
// fallow-ignore-file complexity

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  collectSourceFiles,
  collectSpecifiers,
  normalizePath,
  stripQueryAndHash,
} from './feature-import-utils.mjs'

const ROOT_DIR = process.cwd()
const DEFAULT_API_DIR = path.join(ROOT_DIR, 'api')

/** @param {string} specifier */
export function isSrcImport(specifier) {
  return (
    specifier.startsWith('../src/') ||
    specifier.startsWith('../src\\') ||
    specifier === '../src' ||
    specifier.startsWith('../../src/')
  )
}

/** Relative imports in api/ must use explicit `.js` extensions for Vercel Node ESM. */
/** @param {string} specifier */
export function isExtensionlessRelativeImport(specifier) {
  const bare = stripQueryAndHash(specifier)
  if (!bare.startsWith('.')) {
    return false
  }
  if (bare.endsWith('.js') || bare.endsWith('.json')) {
    return false
  }
  return true
}

/**
 * @param {string} apiDir
 * @param {string} [rootDir]
 */
export function collectApiImportViolations(apiDir, rootDir = ROOT_DIR) {
  if (!fs.existsSync(apiDir)) {
    throw new Error(`Cannot find api directory: ${apiDir}`)
  }

  const files = collectSourceFiles(apiDir)
  /** @type {{ file: string, specifier: string, kind: 'src' | 'extensionless' }[]} */
  const violations = []

  for (const absolutePath of files) {
    const relativePath = normalizePath(path.relative(rootDir, absolutePath))
    const source = fs.readFileSync(absolutePath, 'utf8')
    for (const specifier of collectSpecifiers(source)) {
      if (isSrcImport(specifier)) {
        violations.push({ file: relativePath, specifier, kind: 'src' })
      } else if (isExtensionlessRelativeImport(specifier)) {
        violations.push({ file: relativePath, specifier, kind: 'extensionless' })
      }
    }
  }

  return violations
}

function main() {
  const apiDir = process.env.API_IMPORT_CHECK_DIR
    ? path.resolve(process.env.API_IMPORT_CHECK_DIR)
    : DEFAULT_API_DIR

  const violations = collectApiImportViolations(apiDir)

  if (violations.length > 0) {
    const srcViolations = violations.filter((v) => v.kind === 'src')
    const extensionless = violations.filter((v) => v.kind === 'extensionless')

    if (srcViolations.length > 0) {
      console.error(
        `API src import check failed. Found ${srcViolations.length} import(s) from src/:\n`
      )
      for (const violation of srcViolations.sort(
        (a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier)
      )) {
        console.error(`- ${violation.file}: "${violation.specifier}"`)
      }
      console.error(
        '\nFix: duplicate shared constants/modules under api/ — Vercel serverless cannot load ../src/*.ts at runtime.'
      )
    }

    if (extensionless.length > 0) {
      console.error(
        `API ESM import check failed. Found ${extensionless.length} extensionless relative import(s):\n`
      )
      for (const violation of extensionless.sort(
        (a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier)
      )) {
        console.error(`- ${violation.file}: "${violation.specifier}"`)
      }
      console.error(
        '\nFix: use explicit `.js` extensions on every relative import/export (e.g. `./foo.js`, `./dir/index.js`).'
      )
    }

    process.exit(1)
  }

  console.log(
    'API import checks passed: no api/ imports from src/, and all relative imports use `.js`.'
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
