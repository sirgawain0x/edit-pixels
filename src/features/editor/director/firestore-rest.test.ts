import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  documentIdFromName,
  encodeFirestoreNumber,
  encodeFirestoreString,
  encodeFirestoreStringArray,
  encodeFirestoreTimestamp,
  firestoreDocumentsRoot,
  readFirestoreString,
  readFirestoreTimestamp,
  withTimeout,
} from '../../../../api/_firestore-rest'

describe('firestore REST helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('builds the named-database documents root', () => {
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'creative-ai-491118')
    vi.stubEnv('FIRESTORE_DATABASE_ID', 'creative-director-1')
    expect(firestoreDocumentsRoot()).toBe(
      'https://firestore.googleapis.com/v1/projects/creative-ai-491118/databases/creative-director-1/documents',
    )
  })

  it('encodes scalar and array field values', () => {
    expect(encodeFirestoreString('hello')).toEqual({ stringValue: 'hello' })
    expect(encodeFirestoreNumber(12)).toEqual({ integerValue: '12' })
    expect(encodeFirestoreNumber(2.5)).toEqual({ doubleValue: 2.5 })
    expect(encodeFirestoreStringArray(['a', 'b'])).toEqual({
      arrayValue: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] },
    })
    expect(encodeFirestoreTimestamp('2026-10-02T00:00:00.000Z')).toEqual({
      timestampValue: '2026-10-02T00:00:00.000Z',
    })
  })

  it('reads document fields and ids', () => {
    expect(documentIdFromName('projects/p/databases/d/documents/director_sessions/abc')).toBe(
      'abc',
    )
    expect(readFirestoreString({ stringValue: 'x' })).toBe('x')
    expect(readFirestoreString({ nullValue: null })).toBeNull()
    expect(readFirestoreTimestamp({ timestampValue: '2026-10-02T00:00:00.000Z' })).toBe(
      '2026-10-02T00:00:00.000Z',
    )
  })

  it('times out a hanging promise', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, 'unit')).rejects.toThrow(
      /timed out after 20ms/,
    )
  })

  it('resolves before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 200, 'unit')).resolves.toBe('ok')
  })
})
