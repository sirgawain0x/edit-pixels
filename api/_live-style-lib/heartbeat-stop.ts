// fallow-ignore-file unused-export,complexity,code-duplication
import type { LiveStylePaymentLedger } from './payment/types.js'
import {
  stopLiveStyleSession,
  type HeartbeatResult,
  type LiveStyleSessionRecord,
} from './session-broker.js'

/** After a stopping heartbeat, return the session record with final settlement applied. */
export async function sessionAfterStoppingHeartbeat(
  result: HeartbeatResult,
  ledger: LiveStylePaymentLedger,
  env?: { providerUrl?: string },
): Promise<LiveStyleSessionRecord> {
  if (!result.shouldStop) return result.session
  if (result.session.metering.stopReason === 'heartbeat_missed') {
    return result.session
  }
  return stopLiveStyleSession(
    result.session,
    ledger,
    result.session.metering.stopReason ?? 'stop',
    env,
  )
}
