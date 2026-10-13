#!/usr/bin/env node
// fallow-ignore-file complexity

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  collectSourceFiles,
  collectSpecifiers,
  normalizePath,
} from './feature-import-utils.mjs'

const ROOT_DIR = process.cwd()
const API_DIR = path.join(ROOT_DIR, 'api')

function isSrcImport(specifier) {
  return (
    specifier.startsWith('../src/') ||
    specifier.startsWith('../src\\') ||
    specifier === '../src' ||
    specifier.startsWith('../../src/')
  )
}

function main() {
  if (!fs.existsSync(API_DIR)) {
    console.error('Cannot find api directory.')
    process.exit(1)
  }

  const files = collectSourceFiles(API_DIR)
  const violations = []

  for (const absolutePath of files) {
    const relativePath = normalizePath(path.relative(ROOT_DIR, absolutePath))
    const source = fs.readFileSync(absolutePath, 'utf8')
    for (const specifier of collectSpecifiers(source)) {
      if (isSrcImport(specifier)) {
        violations.push({ file: relativePath, specifier })
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `API src import check failed. Found ${violations.length} import(s) from src/:\n`
    )
    const ordered = violations.sort(
      (a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier)
    )
    for (const violation of ordered) {
      console.error(`- ${violation.file}: "${violation.specifier}"`)
    }
    console.error(
      '\nFix: duplicate shared constants/modules under api/ — Vercel serverless cannot load ../src/*.ts at runtime.'
    )
    process.exit(1)
  }

  console.log('API src import check passed: no api/ imports from src/.')
}

main()
