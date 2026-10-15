import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getAddress } from 'viem'
import { predictPixelsSmartAccountForSigner } from '../../../../api/_pixels-smart-account.js'

const { getUserById, verifyAuthToken, listDirectorSessions, isDirectorFirestoreEnabled } =
  vi.hoisted(() => ({
    getUserById: vi.fn(),
    verifyAuthToken: vi.fn(),
    listDirectorSessions: vi.fn(),
    isDirectorFirestoreEnabled: vi.fn(),
  }))

vi.mock('@privy-io/server-auth', () => ({
  PrivyClient: class MockPrivyClient {
    verifyAuthToken = verifyAuthToken
    getUserById = getUserById
  },
}))

vi.mock('../../../../api/_director-firestore.js', () => ({
  listDirectorSessions: (...args: unknown[]) => listDirectorSessions(...args),
}))

vi.mock('../../../../api/_firestore-client.js', () => ({
  isDirectorFirestoreEnabled: () => isDirectorFirestoreEnabled(),
}))

const SIGNER = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
const SMART = predictPixelsSmartAccountForSigner(SIGNER)
const STRANGER = getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')

function linkedUser() {
  verifyAuthToken.mockResolvedValue({ userId: 'user-1' })
  getUserById.mockResolvedValue({
    linkedAccounts: [{ type: 'wallet', address: SIGNER }],
  })
}

function sessionsUrl(wallet: string): string {
  return `http://localhost/api/director-sessions?wallet=${wallet}`
}

describe('GET /api/director-sessions', () => {
  beforeEach(() => {
    verifyAuthToken.mockReset()
    getUserById.mockReset()
    listDirectorSessions.mockReset()
    isDirectorFirestoreEnabled.mockReturnValue(true)
    listDirectorSessions.mockResolvedValue([{ sessionId: 's1' }])
    process.env.PRIVY_APP_ID = 'app'
    process.env.PRIVY_APP_SECRET = 'secret'
    delete process.env.VERCEL
  })

  it('returns 401 when bearer token is missing', async () => {
    const { GET } = await import('../../../../api/director-sessions.js')
    const response = await GET(
      new Request(sessionsUrl(SIGNER), {
        headers: { Origin: 'http://localhost' },
      }),
    )
    expect(response.status).toBe(401)
  })

  it('returns 401 for forged Origin without a token', async () => {
    const { GET } = await import('../../../../api/director-sessions.js')
    process.env.VERCEL = '1'
    const response = await GET(
      new Request(sessionsUrl(STRANGER), {
        headers: {
          Host: 'app.example.com',
          Origin: 'https://app.example.com',
        },
      }),
    )
    expect(response.status).toBe(401)
  })

  it('returns 403 when wallet does not match the verified signer', async () => {
    linkedUser()
    const { GET } = await import('../../../../api/director-sessions.js')
    const response = await GET(
      new Request(sessionsUrl(STRANGER), {
        headers: {
          Authorization: 'Bearer good',
          'x-pixels-signer': SIGNER,
        },
      }),
    )
    expect(response.status).toBe(403)
  })

  it('returns 200 for case-insensitive wallet match (predicted smart account)', async () => {
    linkedUser()
    const mixedCaseSmart = SMART.replace('0x', '0X').toUpperCase()
    const { GET } = await import('../../../../api/director-sessions.js')
    const response = await GET(
      new Request(sessionsUrl(mixedCaseSmart), {
        headers: {
          Authorization: 'Bearer good',
          'x-pixels-signer': SIGNER,
        },
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { sessions: unknown[] }
    expect(body.sessions).toHaveLength(1)
    expect(listDirectorSessions).toHaveBeenCalledWith(
      expect.objectContaining({ walletAddress: SMART }),
    )
  })
})
