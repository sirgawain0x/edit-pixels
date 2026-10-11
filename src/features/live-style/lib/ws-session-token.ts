import { createHmac, timingSafeEqual } from 'node:crypto'
import { isLiveStyleWsSessionRevoked } from './ws-session-revocation'

export interface LiveStyleWsTokenPayload {
  sessionId: string
  wallet: string
  expMs: number
}

const TOKEN_VERSION = 'v1'

function buildLiveStyleWsTokenMessage(payload: LiveStyleWsTokenPayload): string {
  return [
    TOKEN_VERSION,
    payload.sessionId,
    payload.wallet.toLowerCase(),
    String(payload.expMs),
  ].join('|')
}

export function signLiveStyleWsToken(
  payload: LiveStyleWsTokenPayload,
  secret: string,
): string {
  const message = buildLiveStyleWsTokenMessage(payload)
  const sig = createHmac('sha256', secret).update(message).digest('base64url')
  const body = Buffer.from(message, 'utf8').toString('base64url')
  return `${body}.${sig}`
}

export type VerifyLiveStyleWsTokenResult =
  | { ok: true; payload: LiveStyleWsTokenPayload }
  | { ok: false; reason: string }

export function verifyLiveStyleWsSessionToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): VerifyLiveStyleWsTokenResult {
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'invalid_ws_token_format' }
  }

  const message = Buffer.from(parts[0], 'base64url').toString('utf8')
  const expectedSig = createHmac('sha256', secret).update(message).digest('base64url')
  const actualSig = parts[1]
  try {
    const a = Buffer.from(expectedSig)
    const b = Buffer.from(actualSig)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'invalid_ws_token_signature' }
    }
  } catch {
    return { ok: false, reason: 'invalid_ws_token_signature' }
  }

  const segments = message.split('|')
  if (segments.length !== 4 || segments[0] !== TOKEN_VERSION) {
    return { ok: false, reason: 'invalid_ws_token_payload' }
  }

  const sessionId = segments[1] ?? ''
  const wallet = segments[2] ?? ''
  const expMs = Number(segments[3])
  if (!sessionId || !wallet.startsWith('0x') || !Number.isFinite(expMs)) {
    return { ok: false, reason: 'invalid_ws_token_payload' }
  }
  if (expMs <= nowMs) {
    return { ok: false, reason: 'ws_token_expired' }
  }
  if (isLiveStyleWsSessionRevoked(sessionId)) {
    return { ok: false, reason: 'ws_token_revoked' }
  }

  return {
    ok: true,
    payload: { sessionId, wallet, expMs },
  }
}
