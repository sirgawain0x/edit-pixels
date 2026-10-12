/**
 * Settle a Director invoice: optional on-chain CRTVAI transfer, then stream.
 */

import { buildDirectorPaymentOp } from './build-director-payment'
import type { PendingDirectorInvoice } from './director-invoice-card'
import { fetchDirectorServerQuote } from './fetch-director-server-quote'
import type { SmartWalletOp } from '@/hooks/use-smart-wallet-ops'

export interface ConfirmDirectorInvoiceArgs {
  invoice: PendingDirectorInvoice
  balance: number
  canPayOnChain: boolean
  /** Smart account used for on-chain CRTVAI payment (payer only). */
  account?: string
  /** Privy-linked signer EOA (identity). */
  signerAddress?: `0x${string}`
  getAccessToken: () => Promise<string | null | undefined>
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
      signerAddress?: string
      accessToken?: string
      projectId?: string
      quoteId?: string
      quoteSignature?: string
      quoteExpiresAtMs?: number
      quoteSlippageBps?: number
      quoteEstimatedUsdc6?: number
      quoteCrtvaiRequired?: string
      quoteTier?: 'retail' | 'premium'
    },
  ) => Promise<void>
}

// fallow-ignore-next-line complexity
export async function confirmDirectorInvoice(args: ConfirmDirectorInvoiceArgs): Promise<void> {
  const {
    invoice,
    balance,
    canPayOnChain,
    account,
    signerAddress,
    getAccessToken,
    sendOps,
    refreshBalance,
    submit,
  } = args
  const { brief, apiPrompt, audioUri, quote: invoiceQuote } = invoice

  const token = await getAccessToken()
  if (!token) {
    throw new Error('Connect your wallet to refresh the Director quote.')
  }

  if (!signerAddress) {
    throw new Error('Connect your wallet to refresh the Director quote.')
  }

  const checkoutQuote = await fetchDirectorServerQuote(
    { token, signerAddress },
    { audioDurationSeconds: invoiceQuote.audioDurationSeconds },
  )
  if (!checkoutQuote) {
    throw new Error('Could not refresh the Director quote — close the invoice and try again.')
  }

  if (
    checkoutQuote.estimatedUsdc6 !== invoiceQuote.estimatedUsdc6 ||
    checkoutQuote.tier !== invoiceQuote.tier
  ) {
    throw new Error('Director price changed — close the invoice and brief again.')
  }

  if (balance < checkoutQuote.crtvaiDisplay) {
    throw new Error('Insufficient CRTVAI balance for this Director invoice.')
  }

  let paymentTxHash: string | undefined
  if (canPayOnChain) {
    const { txHash } = await sendOps([buildDirectorPaymentOp(checkoutQuote.crtvaiWei)])
    paymentTxHash = txHash
    refreshBalance()
  }

  const quote = checkoutQuote

  await submit(brief, {
    apiPrompt,
    accessToken: token,
    ...(audioUri ? { audioUri } : {}),
    audioDurationSeconds: quote.audioDurationSeconds,
    ...(paymentTxHash ? { paymentTxHash } : {}),
    ...(account ? { walletAddress: account, userId: account } : {}),
    signerAddress,
    ...(invoice.projectId ? { projectId: invoice.projectId } : {}),
    ...(quote.quoteId
      ? {
          quoteId: quote.quoteId,
          quoteSignature: quote.signature,
          quoteExpiresAtMs: quote.expiresAtMs,
          quoteSlippageBps: quote.slippageBps,
          quoteEstimatedUsdc6: quote.estimatedUsdc6,
          quoteCrtvaiRequired: quote.crtvaiWei.toString(),
          quoteTier: quote.tier,
        }
      : {}),
  })
}
