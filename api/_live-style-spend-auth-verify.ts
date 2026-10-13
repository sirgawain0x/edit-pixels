/**
 * On-chain verification for Live Style capped spend authorization.
 */
// fallow-ignore-file complexity

import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'
import { USDC_ADDRESS_BY_CHAIN_ID } from './_usdc-by-chain-id.js'
import {
  spendAuthProofTxHash,
  verifyLiveStyleSpendAuth,
} from './_live-style-lib/spend-auth-verify.js'
import type { LiveStyleSpendAuthMethod } from './_live-style-lib/payment/types.js'
import {
  consumePaymentTxHash,
  isPaymentLedgerReady,
} from './_payment-ledger.js'
import { getLiveStylePaymentSpender, isLiveStyleEnabled } from './_live-style-config.js'
import type { PaymentVerifyResult } from './director-billing.js'

function alchemyRpcUrl(): string {
  const key = process.env.ALCHEMY_API_KEY?.trim() || process.env.VITE_ALCHEMY_API_KEY?.trim() || ''
  return key ? `https://base-mainnet.g.alchemy.com/v2/${key}` : 'https://mainnet.base.org'
}

export function isLiveStyleSpendAuthEnforced(): boolean {
  if (process.env.LIVE_STYLE_SPEND_AUTH_SOFT === '1') return false
  if (!isLiveStyleEnabled()) return false
  return Boolean(getLiveStylePaymentSpender())
}

async function verifyLiveStyleSpendAuthOnChain(options: {
  proof: string
  method: LiveStyleSpendAuthMethod
  wallet: string
  capUsdc6: number
  nowMs: number
}): Promise<PaymentVerifyResult> {
  const spender = getLiveStylePaymentSpender()
  if (!spender) {
    return { ok: false, reason: 'Live Style payment spender not configured' }
  }

  const usdc = USDC_ADDRESS_BY_CHAIN_ID[base.id]
  if (!usdc) return { ok: false, reason: 'USDC not configured for Base' }

  const client = createPublicClient({
    chain: base,
    transport: http(alchemyRpcUrl()),
  })

  const verified = await verifyLiveStyleSpendAuth({
    proof: options.proof,
    method: options.method,
    wallet: options.wallet,
    spender,
    usdcToken: usdc,
    minCapUsdc6: BigInt(options.capUsdc6),
    nowMs: options.nowMs,
    client,
  })

  if (!verified.ok) return verified
  return { ok: true, amountWei: BigInt(options.capUsdc6) }
}

export async function verifyAndConsumeLiveStyleSpendAuth(options: {
  proof: string
  method: LiveStyleSpendAuthMethod
  wallet: string
  capUsdc6: number
  nowMs: number
}): Promise<PaymentVerifyResult> {
  if (isLiveStyleSpendAuthEnforced() && !isPaymentLedgerReady()) {
    return { ok: false, reason: 'Payment ledger unavailable (configure Upstash/Vercel KV)' }
  }

  const verified = await verifyLiveStyleSpendAuthOnChain(options)
  if (!verified.ok) return verified

  if (isLiveStyleSpendAuthEnforced()) {
    const txHash = spendAuthProofTxHash(options.proof)
    const consumed = await consumePaymentTxHash(txHash, {
      wallet: options.wallet,
      purpose: 'live-style:cap',
    })
    if (!consumed.ok) return { ok: false, reason: consumed.reason }
  }

  return verified
}
