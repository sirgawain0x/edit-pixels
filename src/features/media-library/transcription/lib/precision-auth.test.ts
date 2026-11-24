import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  bearerHeader,
  getPrecisionAccessToken,
  registerPrecisionAccessToken,
} from './precision-auth'

/**
 * `POST /api/transcribe-precision` answered `401 missing authorization` for every run because the
 * client sent only `content-type`: `resolvePixelsIdentity` accepts a Privy bearer token or
 * `body.token`, and the request carried neither.
 */
describe('precision access token slot', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
  })

  it('has no token before a bridge is mounted', async () => {
    await expect(getPrecisionAccessToken()).resolves.toBeNull()
  })

  it('returns the token the bridge provides', async () => {
    cleanups.push(registerPrecisionAccessToken(async () => 'privy-token'))

    await expect(getPrecisionAccessToken()).resolves.toBe('privy-token')
  })

  it('treats a blank token as no token', async () => {
    cleanups.push(registerPrecisionAccessToken(async () => '   '))

    await expect(getPrecisionAccessToken()).resolves.toBeNull()
  })

  it('swallows a provider that throws, so the route answers instead', async () => {
    cleanups.push(
      registerPrecisionAccessToken(async () => {
        throw new Error('wallet locked')
      }),
    )

    await expect(getPrecisionAccessToken()).resolves.toBeNull()
  })

  it('stops providing once the bridge unmounts', async () => {
    const unregister = registerPrecisionAccessToken(async () => 'privy-token')
    unregister()

    await expect(getPrecisionAccessToken()).resolves.toBeNull()
  })

  it('builds the header from the scheme and the token', () => {
    expect(bearerHeader('abc')).toBe('Bearer abc')
    // A token containing spaces must stay one value, not split into a malformed header.
    expect(bearerHeader('a b')).toBe('Bearer a b')
  })
})
