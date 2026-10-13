/**
 * Server-side payment ledger for Live Style.
 */

import { createInMemoryLiveStylePaymentLedger } from '../src/features/live-style/lib/payment/in-memory-ledger.ts'
import {
  createServerLiveStylePaymentLedger,
  isLiveStylePaymentLedgerTestMode,
} from '../src/features/live-style/lib/payment/server-ledger.ts'
import type { LiveStylePaymentLedger } from '../src/features/live-style/lib/payment/types.ts'

let ledger: LiveStylePaymentLedger | null = null

export function getLiveStylePaymentLedger(): LiveStylePaymentLedger {
  if (!ledger) {
    ledger = isLiveStylePaymentLedgerTestMode()
      ? createInMemoryLiveStylePaymentLedger()
      : createServerLiveStylePaymentLedger()
  }
  return ledger
}
