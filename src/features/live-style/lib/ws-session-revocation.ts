/** In-process WS session token revocation (matches session store lifetime). */

const revokedSessionIds = new Set<string>()

export function revokeLiveStyleWsSession(sessionId: string): void {
  revokedSessionIds.add(sessionId)
}

export function isLiveStyleWsSessionRevoked(sessionId: string): boolean {
  return revokedSessionIds.has(sessionId)
}

/** Test helper — clear revocation set between cases. */
export function resetLiveStyleWsRevocations(): void {
  revokedSessionIds.clear()
}
