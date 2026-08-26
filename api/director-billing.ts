/// <reference types="node" />
/**
 * Creative Director billing helpers for the Vercel `/api/director` proxy.
 * Quotes are USDC6; settlement is a CRTVAI transfer to the platform treasury.
 */

import { createPublicClient, http, type Hex } from 'viem'
import { base } from 'viem/chains'
import { isPremiumWallet } from './_premium-membership.js'
import { consumePaymentTxHash, isPaymentLedgerReady } from './_payment-ledger.js'

/** Mirrors `DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL` in src/config/billing.ts */
const DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL = 50_000
/** Mirrors `DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM` in src/config/billing.ts */
const DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM = 25_000

const CRTVAI_DIAMOND = '0xecb695544a3d2a64d579b3828f3f60f6932f4846'

export interface DirectorBillingQuote {
  billableMinutes: number
  estimatedUsdc6: number
  /** Minimum CRTVAI wei expected (usdc6 × 1e12). */
  minCrtvaiWei: bigint
  tier: 'retail' | 'premium'
}

function billableAudioMinutes(audioDurationSeconds: number): number {
  if (!Number.isFinite(audioDurationSeconds) || audioDurationSeconds <= 0) return 0
  return audioDurationSeconds / 60
}

export function quoteDirectorRate(
  audioDurationSeconds: number,
  isPremium: boolean,
): DirectorBillingQuote | null {
  const minutes = billableAudioMinutes(audioDurationSeconds)
  if (minutes <= 0) return null
  const rate = isPremium
    ? DIRECTOR_USDC6_PER_AUDIO_MINUTE_PREMIUM
    : DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL
  const estimatedUsdc6 = Math.round((audioDurationSeconds * rate) / 60)
  if (estimatedUsdc6 <= 0) return null
  return {
    billableMinutes: minutes,
    estimatedUsdc6,
    minCrtvaiWei: BigInt(estimatedUsdc6) * 10n ** 12n,
    tier: isPremium ? 'premium' : 'retail',
  }
}

/** Always retail — use when membership is unknown. */
export function quoteDirectorRetail(audioDurationSeconds: number): DirectorBillingQuote | null {
  return quoteDirectorRate(audioDurationSeconds, false)
}

/** Resolve quote using on-chain Unlock membership for `walletAddress`. */
export async function quoteDirectorForWallet(
  audioDurationSeconds: number,
  walletAddress: string | undefined,
): Promise<DirectorBillingQuote | null> {
  const premium = walletAddress ? await isPremiumWallet(walletAddress) : false
  return quoteDirectorRate(audioDurationSeconds, premium)
}

// fallow-ignore-next-line complexity
function getDirectorTreasury(): `0x${string}` | null {
  const raw =
    process.env.PIXELS_TREASURY_ADDRESS?.trim() ||
    process.env.VITE_SUPERFLUID_RECEIVER?.trim() ||
    ''
  return raw.startsWith('0x') && raw.length >= 42 ? (raw as `0x${string}`) : null
}

/** Enforce CRTVAI payment on deployed Vercel when a treasury is configured. */
export function isDirectorBillingEnforced(): boolean {
  if (process.env.DIRECTOR_BILLING_SOFT === '1') return false
  return Boolean(process.env.VERCEL && getDirectorTreasury())
}

function alchemyRpcUrl(): string {
  const key = process.env.ALCHEMY_API_KEY?.trim() || process.env.VITE_ALCHEMY_API_KEY?.trim() || ''
  return key ? `https://base-mainnet.g.alchemy.com/v2/${key}` : 'https://mainnet.base.org'
}

export type PaymentVerifyResult = { ok: true; amountWei: bigint } | { ok: false; reason: string }

/**
 * Confirm a CRTVAI Transfer log from `from` → treasury in `txHash`.
 */
// fallow-ignore-next-line complexity
export async function verifyDirectorPayment(options: {
  txHash: string
  from: string
  minAmountWei: bigint
}): Promise<PaymentVerifyResult> {
  const treasury = getDirectorTreasury()
  if (!treasury) return { ok: false, reason: 'Treasury not configured' }

  const from = options.from.trim().toLowerCase()
  const to = treasury.toLowerCase()
  if (!from.startsWith('0x') || from.length < 42) {
    return { ok: false, reason: 'Invalid wallet address' }
  }
  if (!options.txHash.startsWith('0x')) {
    return { ok: false, reason: 'Invalid payment transaction hash' }
  }

  const client = createPublicClient({
    chain: base,
    transport: http(alchemyRpcUrl()),
  })

  try {
    const receipt = await client.getTransactionReceipt({
      hash: options.txHash as Hex,
    })
    if (receipt.status !== 'success') {
      return { ok: false, reason: 'Payment transaction failed' }
    }

    const fromPad = `0x000000000000000000000000${from.slice(2)}`.toLowerCase()
    const toPad = `0x000000000000000000000000${to.slice(2)}`.toLowerCase()

    const logs = receipt.logs.filter(
      (log) =>
        log.address.toLowerCase() === CRTVAI_DIAMOND.toLowerCase() &&
        log.topics[1]?.toLowerCase() === fromPad &&
        log.topics[2]?.toLowerCase() === toPad,
    )

    if (logs.length === 0) {
      return { ok: false, reason: 'No matching CRTVAI transfer to treasury found' }
    }

    let amountWei = 0n
    for (const log of logs) {
      amountWei += BigInt(log.data)
    }

    if (amountWei < options.minAmountWei) {
      return {
        ok: false,
        reason: `Payment too low: need ${options.minAmountWei} wei, got ${amountWei}`,
      }
    }

    return { ok: true, amountWei }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Payment verification failed',
    }
  }
}

/**
 * Verify on-chain transfer then consume the tx hash (anti-replay).
 */
export async function verifyAndConsumeDirectorPayment(options: {
  txHash: string
  from: string
  minAmountWei: bigint
  purpose: string
}): Promise<PaymentVerifyResult> {
  if (isDirectorBillingEnforced() && !isPaymentLedgerReady()) {
    return { ok: false, reason: 'Payment ledger unavailable (configure Upstash/Vercel KV)' }
  }

  const verified = await verifyDirectorPayment(options)
  if (!verified.ok) return verified

  if (isDirectorBillingEnforced()) {
    const consumed = await consumePaymentTxHash(options.txHash, {
      wallet: options.from,
      purpose: options.purpose,
    })
    if (!consumed.ok) return { ok: false, reason: consumed.reason }
  }

  return verified
}
