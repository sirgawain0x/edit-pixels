/// <reference types="node" />
/**
 * Creative Director billing helpers for the Vercel `/api/director` proxy.
 * Quotes are USDC6; settlement is a CRTVAI transfer to the platform treasury.
 */

import { createPublicClient, http, type Hex } from 'viem'
import { base } from 'viem/chains'

/** Mirrors `DIRECTOR_USDC6_PER_AUDIO_MINUTE_RETAIL` in src/config/billing.ts */
export const DIRECTOR_USDC6_PER_AUDIO_MINUTE = 50_000

const CRTVAI_DIAMOND = '0xecb695544a3d2a64d579b3828f3f60f6932f4846'

export interface DirectorBillingQuote {
  billableMinutes: number
  estimatedUsdc6: number
  /** Minimum CRTVAI wei expected (usdc6 × 1e12). */
  minCrtvaiWei: bigint
}

export function billableAudioMinutes(audioDurationSeconds: number): number {
  if (!Number.isFinite(audioDurationSeconds) || audioDurationSeconds <= 0) return 0
  return Math.max(1, Math.ceil(audioDurationSeconds / 60))
}

export function quoteDirectorRetail(audioDurationSeconds: number): DirectorBillingQuote | null {
  const minutes = billableAudioMinutes(audioDurationSeconds)
  if (minutes <= 0) return null
  const estimatedUsdc6 = minutes * DIRECTOR_USDC6_PER_AUDIO_MINUTE
  return {
    billableMinutes: minutes,
    estimatedUsdc6,
    minCrtvaiWei: BigInt(estimatedUsdc6) * 10n ** 12n,
  }
}

export function getDirectorTreasury(): `0x${string}` | null {
  const raw =
    process.env.PIXELS_TREASURY_ADDRESS?.trim() ||
    process.env.VITE_SUPERFLUID_RECEIVER?.trim() ||
    ''
  if (!raw.startsWith('0x') || raw.length < 42) return null
  return raw as `0x${string}`
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
