import { describe, expect, it } from 'vitest'
import {
  revokeLiveStyleWsSession,
  resetLiveStyleWsRevocations,
} from './ws-session-revocation'
import {
  signLiveStyleWsToken,
  verifyLiveStyleWsSessionToken,
} from './ws-session-token'

const SECRET = 'test-ws-secret'

describe('live style ws session token', () => {
  it('signs and verifies', () => {
    const expMs = Date.now() + 60_000
    const token = signLiveStyleWsToken(
      { sessionId: 'ls_abc', wallet: '0xAbC', expMs },
      SECRET,
    )
    const verified = verifyLiveStyleWsSessionToken(token, SECRET)
    expect(verified.ok).toBe(true)
    if (verified.ok) {
      expect(verified.payload.sessionId).toBe('ls_abc')
      expect(verified.payload.wallet).toBe('0xabc')
    }
  })

  it('rejects expired token', () => {
    const token = signLiveStyleWsToken(
      { sessionId: 'ls_abc', wallet: '0xabc', expMs: Date.now() - 1 },
      SECRET,
    )
    const verified = verifyLiveStyleWsSessionToken(token, SECRET, Date.now())
    expect(verified.ok).toBe(false)
    if (!verified.ok) expect(verified.reason).toBe('ws_token_expired')
  })

  it('rejects tampered token', () => {
    const token = signLiveStyleWsToken(
      { sessionId: 'ls_abc', wallet: '0xabc', expMs: Date.now() + 60_000 },
      SECRET,
    )
    const tampered = token.replace(/.$/, token.endsWith('a') ? 'b' : 'a')
    const verified = verifyLiveStyleWsSessionToken(tampered, SECRET)
    expect(verified.ok).toBe(false)
  })

  it('rejects revoked session on stop', () => {
    resetLiveStyleWsRevocations()
    const expMs = Date.now() + 60_000
    const token = signLiveStyleWsToken(
      { sessionId: 'ls_stop', wallet: '0xabc', expMs },
      SECRET,
    )
    revokeLiveStyleWsSession('ls_stop')
    const verified = verifyLiveStyleWsSessionToken(token, SECRET)
    expect(verified.ok).toBe(false)
    if (!verified.ok) expect(verified.reason).toBe('ws_token_revoked')
  })

  it('revokes on cap and sweep via session store helper', () => {
    resetLiveStyleWsRevocations()
    const sessionId = 'ls_cap'
    const token = signLiveStyleWsToken(
      { sessionId, wallet: '0xabc', expMs: Date.now() + 60_000 },
      SECRET,
    )
    revokeLiveStyleWsSession(sessionId)
    expect(verifyLiveStyleWsSessionToken(token, SECRET).ok).toBe(false)
  })
})
