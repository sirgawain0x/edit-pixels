// fallow-ignore-file unused-export,complexity,code-duplication
/**
 * Pay-as-you-go Live Style settlement — no custodial prepaid balance.
 */

export type LiveStyleSpendAuthMethod =
  | 'coinbase-spend-permission'
  | 'permit2'
  | 'erc20-approve'

export interface LiveStyleSpendAuthorization {
  sessionId: string
  wallet: string
  capUsdc6: number
  method: LiveStyleSpendAuthMethod
  /** Opaque proof (tx hash, permit signature, spend permission id). */
  proof: string
  createdAtMs: number
}

export interface LiveStyleDebitResult {
  ok: boolean
  amountUsdc6: number
  txHash?: string
  error?: string
}

export interface LiveStylePaymentLedger {
  /** Record the one-time capped authorization at session start. */
  recordAuthorization(auth: LiveStyleSpendAuthorization): Promise<void>
  /** Pull arrears (≈60s); never exceeds cap. */
  pullArrears(sessionId: string, amountUsdc6: number): Promise<LiveStyleDebitResult>
  /** True up after interrupted session (over- or under-pull). */
  trueUp(sessionId: string, adjustmentUsdc6: number): Promise<LiveStyleDebitResult>
}
