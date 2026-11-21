import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getAddress } from 'viem'
import { predictPixelsSmartAccountForSigner } from '../../../../api/_pixels-smart-account.js'

const {
  getUserById,
  verifyAuthToken,
  listDirectorSessions,
  getDirectorSessionTranscript,
  deleteDirectorSession,
  isDirectorFirestoreEnabled,
} = vi.hoisted(() => ({
  getUserById: vi.fn(),
  verifyAuthToken: vi.fn(),
  listDirectorSessions: vi.fn(),
  getDirectorSessionTranscript: vi.fn(),
  deleteDirectorSession: vi.fn(),
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
  getDirectorSessionTranscript: (...args: unknown[]) => getDirectorSessionTranscript(...args),
  deleteDirectorSession: (...args: unknown[]) => deleteDirectorSession(...args),
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

  describe('session transcript + delete', () => {
    const authHeaders = { Authorization: 'Bearer good', 'x-pixels-signer': SIGNER }
    const url = (extra: string) => `${sessionsUrl(SMART)}&${extra}`

    beforeEach(() => {
      getDirectorSessionTranscript.mockReset()
      deleteDirectorSession.mockReset()
    })

    it('returns the full transcript for an owned session', async () => {
      linkedUser()
      getDirectorSessionTranscript.mockResolvedValue({
        sessionId: 'sess-1',
        messages: [
          { role: 'user', content: 'Storyboard this', createdAt: '' },
          { role: 'assistant', content: 'Here is the plan', createdAt: '' },
        ],
        source: 'turns',
      })
      const { GET } = await import('../../../../api/director-sessions.js')
      const response = await GET(new Request(url('sessionId=sess-1'), { headers: authHeaders }))
      expect(response.status).toBe(200)
      const body = (await response.json()) as { transcript: { messages: unknown[] } }
      expect(body.transcript.messages).toHaveLength(2)
      expect(getDirectorSessionTranscript).toHaveBeenCalledWith({
        walletAddress: SMART,
        sessionId: 'sess-1',
      })
      expect(listDirectorSessions).not.toHaveBeenCalled()
    })

    it('returns 404 when the session belongs to someone else', async () => {
      linkedUser()
      getDirectorSessionTranscript.mockResolvedValue(null)
      const { GET } = await import('../../../../api/director-sessions.js')
      const response = await GET(new Request(url('sessionId=other'), { headers: authHeaders }))
      expect(response.status).toBe(404)
    })

    it('rejects malformed session ids', async () => {
      linkedUser()
      const { GET } = await import('../../../../api/director-sessions.js')
      const response = await GET(new Request(url('sessionId=../../etc'), { headers: authHeaders }))
      expect(response.status).toBe(400)
    })

    it('deletes an owned session', async () => {
      linkedUser()
      deleteDirectorSession.mockResolvedValue('deleted')
      const { DELETE } = await import('../../../../api/director-sessions.js')
      const response = await DELETE(
        new Request(url('sessionId=sess-1'), { method: 'DELETE', headers: authHeaders }),
      )
      expect(response.status).toBe(200)
      expect(deleteDirectorSession).toHaveBeenCalledWith({
        walletAddress: SMART,
        sessionId: 'sess-1',
      })
    })

    it('requires auth to delete', async () => {
      const { DELETE } = await import('../../../../api/director-sessions.js')
      const response = await DELETE(new Request(url('sessionId=sess-1'), { method: 'DELETE' }))
      expect(response.status).toBe(401)
      expect(deleteDirectorSession).not.toHaveBeenCalled()
    })

    it('returns 404 when deleting a session the wallet does not own', async () => {
      linkedUser()
      deleteDirectorSession.mockResolvedValue('not_found')
      const { DELETE } = await import('../../../../api/director-sessions.js')
      const response = await DELETE(
        new Request(url('sessionId=nope'), { method: 'DELETE', headers: authHeaders }),
      )
      expect(response.status).toBe(404)
    })
  })
})
