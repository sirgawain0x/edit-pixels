import { describe, expect, it } from 'vitest'
import {
  isOwnedInputUri,
  isSafePartName,
  isUploadContentType,
  transcribeBucket,
} from './_transcribe-uris.js'

const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'
const JOB = 'job-1'
const OWN_URI = `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/${JOB}/part-0.flac`

/**
 * This is the security boundary around BatchRecognize: Google will transcribe any
 * object the service account can read, so a URI that only *looks* like ours must
 * be rejected before it can be submitted.
 */
describe('isOwnedInputUri', () => {
  it('accepts only this job prefix in our bucket', () => {
    expect(isOwnedInputUri(OWN_URI, { accountId: ACCOUNT, jobId: JOB })).toBe(true)
    // Uppercase account ids are normalised, since signers arrive in both cases.
    expect(isOwnedInputUri(OWN_URI, { accountId: ACCOUNT.toUpperCase(), jobId: JOB })).toBe(true)
    // A deeper key inside the job prefix is still ours (e.g. nested upload paths).
    expect(
      isOwnedInputUri(
        `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/${JOB}/retry/part-0.flac`,
        { accountId: ACCOUNT, jobId: JOB },
      ),
    ).toBe(true)
  })

  it.each([
    ['another bucket', 'gs://someone-else/input/'],
    ['another account', 'gs://creative-pixels-transcribe-batch/input/0xdeadbeef/job-1/part-0.flac'],
    ['another job', `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/job-2/part-0.flac`],
    [
      'a prefix lookalike',
      `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/job-10/part-0.flac`,
    ],
    [
      'a traversal',
      `gs://creative-pixels-transcribe-batch/input/${ACCOUNT}/job-1/../../secret.flac`,
    ],
    ['a bucket root escape', 'gs://creative-pixels-transcribe-batch/input/../output/x.json'],
    ['http', 'https://storage.googleapis.com/creative-pixels-transcribe-batch/input/x.flac'],
    ['bare bucket', 'gs://creative-pixels-transcribe-batch'],
    ['bucket with trailing slash', 'gs://creative-pixels-transcribe-batch/'],
    ['empty', ''],
  ])('rejects %s', (_label, uri) => {
    expect(isOwnedInputUri(uri, { accountId: ACCOUNT, jobId: JOB })).toBe(false)
  })
})

describe('transcribeBucket', () => {
  it('defaults to the project bucket and can be overridden per environment', () => {
    const original = process.env.TRANSCRIBE_GCS_BUCKET
    try {
      delete process.env.TRANSCRIBE_GCS_BUCKET
      expect(transcribeBucket()).toBe('creative-pixels-transcribe-batch')

      process.env.TRANSCRIBE_GCS_BUCKET = 'other-bucket'
      expect(transcribeBucket()).toBe('other-bucket')
      // The guard follows the override, so a stale URI from the old bucket is refused.
      expect(isOwnedInputUri(OWN_URI, { accountId: ACCOUNT, jobId: JOB })).toBe(false)
    } finally {
      if (original === undefined) delete process.env.TRANSCRIBE_GCS_BUCKET
      else process.env.TRANSCRIBE_GCS_BUCKET = original
    }
  })
})

describe('isSafePartName', () => {
  it.each(['part-0.webm', 'part-23.opus', 'p.flac', 'A_b-1.wav'])('accepts %s', (name) => {
    expect(isSafePartName(name)).toBe(true)
  })

  it.each([
    ['a path segment', 'a/b.webm'],
    ['a traversal', '../part-0.webm'],
    ['a dotfile', '.hidden'],
    ['empty', ''],
    ['a space', 'part 0.webm'],
    ['too long', 'a'.repeat(65)],
    ['not a string', 42],
  ])('rejects %s', (_label, name) => {
    expect(isSafePartName(name)).toBe(false)
  })
})

describe('isUploadContentType', () => {
  it.each(['audio/webm', 'audio/ogg', 'audio/flac', 'audio/wav'])('accepts %s', (value) => {
    expect(isUploadContentType(value)).toBe(true)
  })

  it.each([
    ['video/mp4', 'video/mp4'],
    ['a bare audio type', 'audio'],
    ['not a string', 7],
  ])('rejects %s', (_label, value) => {
    expect(isUploadContentType(value)).toBe(false)
  })
})
