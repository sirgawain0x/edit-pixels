/**
 * Server-side payment ledger for Live Style.
 */

import { createInMemoryLiveStylePaymentLedger } from './_live-style-lib/payment/in-memory-ledger.js'
import {
  createServerLiveStylePaymentLedger,
  isLiveStylePaymentLedgerTestMode,
} from './_live-style-lib/payment/server-ledger.js'
import type { LiveStylePaymentLedger } from './_live-style-lib/payment/types.js'

let ledger: LiveStylePaymentLedger | null = null

export function getLiveStylePaymentLedger(): LiveStylePaymentLedger {
  if (!ledger) {
    ledger = isLiveStylePaymentLedgerTestMode()
      ? createInMemoryLiveStylePaymentLedger()
      : createServerLiveStylePaymentLedger()
  }
  return ledger
}
