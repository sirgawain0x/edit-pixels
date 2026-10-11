/**
 * Server-side payment ledger for Live Style (mock pulls until G2 wires treasury pull).
 */

import { createInMemoryLiveStylePaymentLedger } from '../src/features/live-style/lib/payment/in-memory-ledger.ts'
import type { LiveStylePaymentLedger } from '../src/features/live-style/lib/payment/types.ts'

let ledger: ReturnType<typeof createInMemoryLiveStylePaymentLedger> | null = null

export function getLiveStylePaymentLedger(): LiveStylePaymentLedger {
  if (!ledger) ledger = createInMemoryLiveStylePaymentLedger()
  return ledger
}
