import { describe, expect, it, vi, beforeEach } from 'vitest'

const { getUserById, verifyAuthToken } = vi.hoisted(() => ({
  getUserById: vi.fn(),
  verifyAuthToken: vi.fn(),
}))

vi.mock('@privy-io/server-auth', () => ({
  PrivyClient: class MockPrivyClient {
    verifyAuthToken = verifyAuthToken
    getUserById = getUserById
  },
}))

vi.mock('../../../api/_director-auth.js', () => ({
  isDirectorSecretAuthorized: (request: Request) =>
    request.headers.get('x-director-secret') === 'test-secret',
}))

const SIGNER_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`
const SIGNER_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`

function linkedUser(wallets: `0x${string}`[]) {
  verifyAuthToken.mockResolvedValue({ userId: 'user-1' })
  getUserById.mockResolvedValue({
    linkedAccounts: wallets.map((address) => ({ type: 'wallet', address })),
  })
}

describe('resolvePixelsIdentity', () => {
  beforeEach(() => {
    verifyAuthToken.mockReset()
    getUserById.mockReset()
    process.env.PRIVY_APP_ID = 'app'
    process.env.PRIVY_APP_SECRET = 'secret'
  })

  it('returns 401 when bearer token is missing', async () => {
    const { resolvePixelsIdentity } = await import('../../../api/_pixels-identity.js')
    const result = await resolvePixelsIdentity(
      new Request('http://localhost/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
  })

  it('uses the only linked wallet when no hint is provided', async () => {
    linkedUser([SIGNER_A])
    const { resolvePixelsIdentity } = await import('../../../api/_pixels-identity.js')
    const result = await resolvePixelsIdentity(
      new Request('http://localhost/api/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer good',
        },
        body: JSON.stringify({ token: 'good' }),
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.identity.signer).toBe(SIGNER_A)
      expect(result.identity.source).toBe('privy')
    }
  })

  it('returns 400 when multiple wallets are linked and hint is missing', async () => {
    linkedUser([SIGNER_A, SIGNER_B])
    const { resolvePixelsIdentity } = await import('../../../api/_pixels-identity.js')
    const result = await resolvePixelsIdentity(
      new Request('http://localhost/api/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer good',
        },
        body: JSON.stringify({ token: 'good' }),
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(400)
  })

  it('returns 403 when hint is not linked', async () => {
    linkedUser([SIGNER_A])
    const { resolvePixelsIdentity } = await import('../../../api/_pixels-identity.js')
    const result = await resolvePixelsIdentity(
      new Request('http://localhost/api/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer good',
          'x-pixels-signer': SIGNER_B,
        },
        body: JSON.stringify({ token: 'good', signerAddress: SIGNER_B }),
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
  })

  it('accepts a non-first linked wallet when hinted', async () => {
    linkedUser([SIGNER_A, SIGNER_B])
    const { resolvePixelsIdentity } = await import('../../../api/_pixels-identity.js')
    const result = await resolvePixelsIdentity(
      new Request('http://localhost/api/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer good',
          'x-pixels-signer': SIGNER_B,
        },
        body: JSON.stringify({ token: 'good', signerAddress: SIGNER_B }),
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.identity.signer).toBe(SIGNER_B)
  })

  it('requires signerAddress on director secret path', async () => {
    const { resolvePixelsIdentity } = await import('../../../api/_pixels-identity.js')
    const result = await resolvePixelsIdentity(
      new Request('http://localhost/api/director', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-director-secret': 'test-secret',
        },
        body: JSON.stringify({ prompt: 'hi' }),
      }),
      { allowDirectorSecret: true },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(400)
  })

  it('trusts signerAddress on director secret path', async () => {
    const { resolvePixelsIdentity } = await import('../../../api/_pixels-identity.js')
    const result = await resolvePixelsIdentity(
      new Request('http://localhost/api/director', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-director-secret': 'test-secret',
        },
        body: JSON.stringify({ prompt: 'hi', signerAddress: SIGNER_A }),
      }),
      { allowDirectorSecret: true },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.identity.signer).toBe(SIGNER_A)
      expect(result.identity.source).toBe('secret')
    }
  })
})

describe('resolvePixelsIdentityGet', () => {
  beforeEach(() => {
    verifyAuthToken.mockReset()
    getUserById.mockReset()
    process.env.PRIVY_APP_ID = 'app'
    process.env.PRIVY_APP_SECRET = 'secret'
  })

  it('keys poll ownership to the verified signer from query hint', async () => {
    linkedUser([SIGNER_A, SIGNER_B])
    const { resolvePixelsIdentityGet } = await import('../../../api/_pixels-identity.js')
    const result = await resolvePixelsIdentityGet(
      new Request(`http://localhost/api/pixels-generate-task?id=1&signer=${SIGNER_B}`, {
        headers: { Authorization: 'Bearer good' },
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.identity.signer).toBe(SIGNER_B)
  })
})
