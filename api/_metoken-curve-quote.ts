/**
 * Server-side CRTVAI curve quotes: live Diamond reads, signed quote IDs, slippage at settlement.
 */
// fallow-ignore-file complexity,unused-export

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createPublicClient, http, parseAbi, type Hex } from 'viem'
import { base } from 'viem/chains'
import {
  CRTVAI_METOKEN_ADDRESS,
  METOKENS_DIAMOND_ADDRESS,
  METOKEN_QUOTE_EXPIRY_SECONDS,
  METOKEN_QUOTE_SLIPPAGE_BPS,
} from './_metoken-curve-config.js'
import {
  type CurveState,
  crtvaiWeiForUsdcListPrice,
  isWithinSlippageBand,
  settlementMinCrtvaiWei,
  usdc6ToMintTargetMetokenWei,
} from './_metoken-curve-math.js'

export {
  METOKEN_QUOTE_EXPIRY_SECONDS,
  METOKEN_QUOTE_SLIPPAGE_BPS,
} from './_metoken-curve-config.js'
export type { CurveState } from './_metoken-curve-math.js'
export {
  calculateMeTokensMintedPure,
  crtvaiWeiForUsdcListPrice,
  isWithinSlippageBand,
  settlementMinCrtvaiWei,
} from './_metoken-curve-math.js'

const DIAMOND_ABI = parseAbi([
  'function calculateMeTokensMinted(address meToken, uint256 assetsDeposited) view returns (uint256 meTokensMinted)',
])

const METOKEN_ABI = parseAbi(['function totalSupply() view returns (uint256)'])

export interface MetokenUsdQuote {
  quoteId: string
  signature: string
  estimatedUsdc6: number
  minCrtvaiWei: bigint
  expiresAtMs: number
  slippageBps: number
  curve: CurveState
}

export type MetokenQuoteErrorCode =
  | 'quote_unpayable'
  | 'quote_expired'
  | 'quote_slippage'
  | 'quote_invalid'

export class MetokenQuoteError extends Error {
  readonly code: MetokenQuoteErrorCode

  constructor(code: MetokenQuoteErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

function alchemyRpcUrl(): string {
  const key = process.env.ALCHEMY_API_KEY?.trim() || process.env.VITE_ALCHEMY_API_KEY?.trim() || ''
  return key ? `https://base-mainnet.g.alchemy.com/v2/${key}` : 'https://mainnet.base.org'
}

function getClient() {
  return createPublicClient({
    chain: base,
    transport: http(alchemyRpcUrl()),
  })
}

export async function readCurveState(): Promise<CurveState> {
  const client = getClient()
  const supplyWei = await client.readContract({
    address: CRTVAI_METOKEN_ADDRESS,
    abi: METOKEN_ABI,
    functionName: 'totalSupply',
  })
  return { supplyWei, balancePooledUsdc6: 0n }
}

export async function readMeTokensMintedForDeposit(assetsUsdc6: bigint): Promise<bigint> {
  const client = getClient()
  return client.readContract({
    address: METOKENS_DIAMOND_ADDRESS,
    abi: DIAMOND_ABI,
    functionName: 'calculateMeTokensMinted',
    args: [CRTVAI_METOKEN_ADDRESS, assetsUsdc6],
  })
}

function signingSecret(): string | null {
  const raw = process.env.PIXELS_QUOTE_SIGNING_SECRET?.trim()
  return raw && raw.length >= 16 ? raw : null
}

function signPayload(payload: string): string {
  const secret = signingSecret()
  if (!secret) {
    return `unsigned:${Buffer.from(payload).toString('base64url')}`
  }
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function buildPayload(parts: {
  quoteId: string
  estimatedUsdc6: number
  minCrtvaiWei: string
  expiresAtMs: number
  slippageBps: number
  tier?: string
}): string {
  return [
    parts.quoteId,
    String(parts.estimatedUsdc6),
    parts.minCrtvaiWei,
    String(parts.expiresAtMs),
    String(parts.slippageBps),
    parts.tier ?? '',
  ].join('|')
}

export function verifyQuoteSignature(quote: {
  quoteId: string
  signature: string
  estimatedUsdc6: number
  minCrtvaiWei: bigint
  expiresAtMs: number
  slippageBps: number
  tier?: string
}): boolean {
  const payload = buildPayload({
    quoteId: quote.quoteId,
    estimatedUsdc6: quote.estimatedUsdc6,
    minCrtvaiWei: quote.minCrtvaiWei.toString(),
    expiresAtMs: quote.expiresAtMs,
    slippageBps: quote.slippageBps,
    tier: quote.tier,
  })
  const expected = signPayload(payload)
  try {
    const a = Buffer.from(quote.signature)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return quote.signature === expected
  }
}

async function assertPayable(minCrtvaiWei: bigint, usdc6: number): Promise<void> {
  if (minCrtvaiWei <= 0n) {
    throw new MetokenQuoteError('quote_unpayable', 'Quote amount is zero')
  }
  let deposit = BigInt(usdc6)
  let minted = await readMeTokensMintedForDeposit(deposit)
  let attempts = 0
  while (minted < minCrtvaiWei && attempts < 24) {
    deposit *= 2n
    minted = await readMeTokensMintedForDeposit(deposit)
    attempts += 1
  }
  if (minted < minCrtvaiWei) {
    throw new MetokenQuoteError(
      'quote_unpayable',
      'This purchase requires more meToken liquidity than the curve can support right now.',
    )
  }
}

/** Price a USD list amount in CRTVAI wei using the live curve. */
export async function quoteCrtvaiForUsdc6(
  estimatedUsdc6: number,
  options?: { tier?: string; quoteId?: string },
): Promise<MetokenUsdQuote> {
  if (!Number.isFinite(estimatedUsdc6) || estimatedUsdc6 <= 0) {
    throw new MetokenQuoteError('quote_unpayable', 'Invalid USD amount')
  }

  const state = await readCurveState()
  const minCrtvaiWei = await readMeTokensMintedForDeposit(BigInt(estimatedUsdc6))
  await assertPayable(minCrtvaiWei, estimatedUsdc6)

  const quoteId = options?.quoteId ?? randomUUID()
  const expiresAtMs = Date.now() + METOKEN_QUOTE_EXPIRY_SECONDS * 1000
  const slippageBps = METOKEN_QUOTE_SLIPPAGE_BPS
  const signature = signPayload(
    buildPayload({
      quoteId,
      estimatedUsdc6,
      minCrtvaiWei: minCrtvaiWei.toString(),
      expiresAtMs,
      slippageBps,
      tier: options?.tier,
    }),
  )

  return {
    quoteId,
    signature,
    estimatedUsdc6,
    minCrtvaiWei,
    expiresAtMs,
    slippageBps,
    curve: state,
  }
}

export async function validateSettlementAgainstQuote(stored: {
  estimatedUsdc6: number
  minCrtvaiWei: bigint
  expiresAtMs: number
  slippageBps: number
}): Promise<{ minAmountWei: bigint }> {
  if (Date.now() > stored.expiresAtMs) {
    throw new MetokenQuoteError('quote_expired', 'Quote expired — request a new price.')
  }

  const freshWei = await readMeTokensMintedForDeposit(BigInt(stored.estimatedUsdc6))
  if (!isWithinSlippageBand(stored.minCrtvaiWei, freshWei, stored.slippageBps)) {
    throw new MetokenQuoteError(
      'quote_slippage',
      'Price moved beyond the quoted band — request a new quote.',
    )
  }

  return { minAmountWei: settlementMinCrtvaiWei(stored.minCrtvaiWei, freshWei) }
}
