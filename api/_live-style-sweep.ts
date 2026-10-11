/**
 * Server-driven stale session sweep (silent clients send no heartbeats).
 */

import { getLiveStyleProviderUrl } from './_live-style-config.js'
import { getLiveStylePaymentLedger } from './_live-style-payment-server.js'
import {
  deleteLiveStyleSession,
  listLiveStyleSessions,
  putLiveStyleSession,
} from './_live-style-session-store.js'
import { sweepStaleLiveStyleSessions } from '../src/features/live-style/lib/session-broker.ts'

export async function runLiveStyleSessionSweep(nowMs = Date.now()): Promise<{
  stoppedSessionIds: string[]
}> {
  const ledger = getLiveStylePaymentLedger()
  const env = { providerUrl: getLiveStyleProviderUrl() }
  const active = listLiveStyleSessions().filter((s) => !s.metering.stopped)
  const { stoppedSessions } = await sweepStaleLiveStyleSessions(active, ledger, nowMs, env)

  const stoppedSessionIds: string[] = []
  for (const stopped of stoppedSessions) {
    putLiveStyleSession(stopped)
    deleteLiveStyleSession(stopped.sessionId)
    stoppedSessionIds.push(stopped.sessionId)
  }

  return { stoppedSessionIds }
}
