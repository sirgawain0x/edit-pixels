/**
 * Settle a Director invoice: optional on-chain CRTVAI transfer, then stream.
 */

import { buildDirectorPaymentOp } from './build-director-payment'
import type { PendingDirectorInvoice } from './director-invoice-card'
import type { SmartWalletOp } from '@/hooks/use-smart-wallet-ops'

export interface ConfirmDirectorInvoiceArgs {
  invoice: PendingDirectorInvoice
  balance: number
  canPayOnChain: boolean
  account?: string
  sendOps: (ops: SmartWalletOp[]) => Promise<{ txHash: string }>
  refreshBalance: () => void
  submit: (
    text: string,
    options?: {
      apiPrompt?: string
      audioUri?: string
      audioDurationSeconds?: number
      paymentTxHash?: string
      walletAddress?: string
    },
  ) => Promise<void>
}

// fallow-ignore-next-line complexity
export async function confirmDirectorInvoice(args: ConfirmDirectorInvoiceArgs): Promise<void> {
  const { invoice, balance, canPayOnChain, account, sendOps, refreshBalance, submit } = args
  const { brief, apiPrompt, audioUri, quote } = invoice

  if (balance < quote.crtvaiDisplay) {
    throw new Error('Insufficient CRTVAI balance for this Director invoice.')
  }

  let paymentTxHash: string | undefined
  if (canPayOnChain) {
    const { txHash } = await sendOps([buildDirectorPaymentOp(quote.crtvaiWei)])
    paymentTxHash = txHash
    refreshBalance()
  }

  await submit(brief, {
    apiPrompt,
    ...(audioUri ? { audioUri } : {}),
    audioDurationSeconds: quote.audioDurationSeconds,
    ...(paymentTxHash ? { paymentTxHash } : {}),
    ...(account ? { walletAddress: account } : {}),
  })
}
