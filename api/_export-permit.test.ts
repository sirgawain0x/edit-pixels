import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EXPORT_PERMIT_TTL_MS,
  ExportPermitConfigError,
  signExportPermit,
  verifyExportPermit,
} from './_export-permit.js'

const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'
const PROJECT = 'project-1'
const SECRET = 'a-test-signing-secret-long-enough'

beforeEach(() => {
  process.env.PIXELS_QUOTE_SIGNING_SECRET = SECRET
})

afterEach(() => {
  delete process.env.PIXELS_QUOTE_SIGNING_SECRET
})

describe('signExportPermit', () => {
  it('refuses to sign without a secret instead of emitting an unsigned token', () => {
    delete process.env.PIXELS_QUOTE_SIGNING_SECRET
    // An unsigned permit cannot be told apart from a forged one, so there is no safe fallback.
    expect(() =>
      signExportPermit({ accountId: ACCOUNT, projectId: PROJECT, txHash: '0xabc' }),
    ).toThrow(ExportPermitConfigError)
  })

  it('also refuses a secret too short to be meaningful', () => {
    process.env.PIXELS_QUOTE_SIGNING_SECRET = 'short'
    expect(() =>
      signExportPermit({ accountId: ACCOUNT, projectId: PROJECT, txHash: '0xabc' }),
    ).toThrow(ExportPermitConfigError)
  })

  it('lower-cases the account, so a checksummed address does not fail its own permit', () => {
    const checksummed = '0x04F5C5691E2F3e79246B08b98e912b3D2a786696'
    const { permit } = signExportPermit({
      accountId: checksummed,
      projectId: PROJECT,
      txHash: '0xabc',
    })

    expect(verifyExportPermit(permit, { accountId: ACCOUNT, projectId: PROJECT })).toMatchObject({
      ok: true,
    })
  })

  it('carries a year-long expiry, so a purchase does not silently lapse', () => {
    const now = 1_700_000_000_000
    const { expiresAtMs } = signExportPermit({
      accountId: ACCOUNT,
      projectId: PROJECT,
      txHash: '0xabc',
      now,
    })

    expect(expiresAtMs).toBe(now + EXPORT_PERMIT_TTL_MS)
  })
})

describe('verifyExportPermit', () => {
  function fresh() {
    return signExportPermit({ accountId: ACCOUNT, projectId: PROJECT, txHash: '0xabc' }).permit
  }

  it('accepts its own permit for the right account and project', () => {
    expect(verifyExportPermit(fresh(), { accountId: ACCOUNT, projectId: PROJECT })).toMatchObject({
      ok: true,
      payload: { accountId: ACCOUNT, projectId: PROJECT, txHash: '0xabc' },
    })
  })

  it('rejects a tampered payload', () => {
    const permit = fresh()
    const [body, signature] = permit.split('.')
    const decoded = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
    // Someone flips the project they unlocked.
    decoded.projectId = 'project-2'
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`

    expect(verifyExportPermit(forged, { accountId: ACCOUNT, projectId: 'project-2' })).toEqual({
      ok: false,
      reason: 'signature',
    })
  })

  it('rejects a permit bought for another project, which is the whole point of scoping', () => {
    expect(verifyExportPermit(fresh(), { accountId: ACCOUNT, projectId: 'project-2' })).toEqual({
      ok: false,
      reason: 'wrong_project',
    })
  })

  it('rejects a permit belonging to another account', () => {
    expect(
      verifyExportPermit(fresh(), {
        accountId: '0x0000000000000000000000000000000000000001',
        projectId: PROJECT,
      }),
    ).toEqual({ ok: false, reason: 'wrong_account' })
  })

  it('rejects an expired permit even with a valid signature', () => {
    const now = 1_700_000_000_000
    const permit = signExportPermit({
      accountId: ACCOUNT,
      projectId: PROJECT,
      txHash: '0xabc',
      now,
    }).permit

    expect(
      verifyExportPermit(permit, {
        accountId: ACCOUNT,
        projectId: PROJECT,
        now: now + EXPORT_PERMIT_TTL_MS + 1,
      }),
    ).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects junk and a permit from a different signing secret', () => {
    expect(verifyExportPermit('not-a-permit', { accountId: ACCOUNT, projectId: PROJECT })).toEqual({
      ok: false,
      reason: 'malformed',
    })

    const permit = fresh()
    process.env.PIXELS_QUOTE_SIGNING_SECRET = 'a-completely-different-secret-value'
    expect(verifyExportPermit(permit, { accountId: ACCOUNT, projectId: PROJECT })).toEqual({
      ok: false,
      reason: 'signature',
    })
  })
})
