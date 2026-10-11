/**
 * In-memory Live Style sessions (dev / single-instance). Redis optional follow-up.
 */

import type { LiveStyleSessionRecord } from '../src/features/live-style/lib/session-broker.ts'
import { revokeLiveStyleWsSession } from '../src/features/live-style/lib/ws-session-revocation.ts'

const sessions = new Map<string, LiveStyleSessionRecord>()
const walletActive = new Map<string, string>()

export function getLiveStyleSession(sessionId: string): LiveStyleSessionRecord | undefined {
  return sessions.get(sessionId)
}

export function putLiveStyleSession(session: LiveStyleSessionRecord): void {
  sessions.set(session.sessionId, session)
  walletActive.set(session.wallet, session.sessionId)
}

export function deleteLiveStyleSession(sessionId: string): void {
  const row = sessions.get(sessionId)
  if (row) walletActive.delete(row.wallet)
  sessions.delete(sessionId)
  revokeLiveStyleWsSession(sessionId)
}

export function getActiveSessionForWallet(wallet: string): LiveStyleSessionRecord | undefined {
  const id = walletActive.get(wallet.toLowerCase())
  if (!id) return undefined
  return sessions.get(id)
}

export function listLiveStyleSessions(): LiveStyleSessionRecord[] {
  return [...sessions.values()]
}
