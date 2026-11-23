/**
 * POST /api/export-permit
 *
 * Two modes, distinguished by whether a payment hash arrives:
 *
 * - **quote** (no `paymentTxHash`): how much CRTVAI removes the watermark for this project.
 *   Priced at $5.00 and converted at the live curve rate, so the dollar price holds while
 *   CRTVAI moves. The response carries the signed curve quote, because the price has to be
 *   pinned at this moment rather than re-derived later.
 * - **redeem** (`paymentTxHash` plus the quote it came from): verify the transfer, spend it
 *   once, then sign a permit bound to this account and project.
 *
 * Three things here are deliberate, and each one used to cost a buyer money:
 *
 * 1. The minimum verified is the *quoted* minimum, not a freshly derived one. Re-pricing at
 *    redemption rejects a buyer who sent exactly the amount the server asked for, the moment
 *    the curve ticks up.
 * 2. The transfer is verified without being consumed, and this route spends it itself with a
 *    claim that can re-issue the same purchase to the same payer. Consuming inside the
 *    verifier makes a lost permit unrecoverable — the buyer would have to pay twice.
 * 3. The permit is signed before the payment is claimed. A missing signing secret must fail
 *    with the money still unspent, or repairing the config afterwards leaves a dead transfer.
 */
import { checkPixelsRateLimits } from './_rate-limit.js'
import { authenticateGenerativePost } from './_pixels-generate-route-auth.js'
import { assertPaymentPayerMatchesSigner } from './_pixels-payment-payer.js'
import {
  quoteCrtvaiForUsdc6,
  isQuoteSigningConfigured,
  validateSettlementAgainstQuote,
  verifyQuoteSignature,
  MetokenQuoteError,
} from './_metoken-curve-quote.js'
import { METOKEN_QUOTE_SETTLEMENT_GRACE_SECONDS } from './_metoken-curve-config.js'
import { verifyDirectorPayment } from './director-billing.js'
import { claimPaymentTxLogForPurpose } from './_payment-ledger.js'
import {
  EXPORT_PERMIT_TTL_MS,
  EXPORT_UNLOCK_PRICE_USD,
  EXPORT_UNLOCK_USDC6,
  ExportPermitConfigError,
  signExportPermit,
} from './_export-permit.js'

/**
 * A ledger claim must outlive the permit it protects: the permit is good for a year, so a claim
 * that expires first would let the same transfer unlock a second project.
 */
const CLAIM_TTL_SECONDS = Math.ceil(EXPORT_PERMIT_TTL_MS / 1000) + 24 * 60 * 60

/** Project ids are opaque to us; long enough for a UUID, short enough to refuse junk. */
const MAX_PROJECT_ID_LENGTH = 128

/** The signed curve quote, as issued by the quote half and handed back by the client. */
interface ExportQuoteProof {
  quoteId: string
  signature: string
  minCrtvaiWei: string
  expiresAtMs: number
  slippageBps: number
}

interface PermitRequest {
  projectId: string
  paymentTxHash: string | null
  quote: ExportQuoteProof | null
}

function readProofString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readProofNumber(raw: Record<string, unknown>, key: string): number | null {
  const value = raw[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readQuoteProof(value: unknown): ExportQuoteProof | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>

  const quoteId = readProofString(raw, 'quoteId')
  const signature = readProofString(raw, 'signature')
  const minCrtvaiWei = readProofString(raw, 'minCrtvaiWei')
  const expiresAtMs = readProofNumber(raw, 'expiresAtMs')
  const slippageBps = readProofNumber(raw, 'slippageBps')

  if (!quoteId || !signature || !minCrtvaiWei) return null
  if (expiresAtMs === null || slippageBps === null) return null
  if (!/^\d+$/.test(minCrtvaiWei)) return null

  return { quoteId, signature, minCrtvaiWei, expiresAtMs, slippageBps }
}

function parseRequest(body: Record<string, unknown>): PermitRequest | null {
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
  if (!projectId || projectId.length > MAX_PROJECT_ID_LENGTH) return null

  const txHash = typeof body.paymentTxHash === 'string' ? body.paymentTxHash.trim() : ''
  return {
    projectId,
    paymentTxHash: txHash.length > 0 ? txHash : null,
    quote: readQuoteProof(body.quote),
  }
}

/**
 * What removing the mark costs right now, converted on the same curve every paid feature uses.
 *
 * The signed quote is part of the response: redemption verifies against the amount the buyer
 * was actually shown, and that amount has to be provable rather than trusted.
 */
async function quoteResponse(projectId: string): Promise<Response> {
  try {
    const quote = await quoteCrtvaiForUsdc6(EXPORT_UNLOCK_USDC6, { tier: 'export-unlock' })
    return Response.json({
      projectId,
      priceUsd: EXPORT_UNLOCK_PRICE_USD,
      estimatedUsdc6: EXPORT_UNLOCK_USDC6,
      minCrtvaiWei: quote.minCrtvaiWei.toString(),
      expiresAtMs: quote.expiresAtMs,
      quoteId: quote.quoteId,
      signature: quote.signature,
      slippageBps: quote.slippageBps,
    })
  } catch (error) {
    console.error('export permit quote failed', error)
    return Response.json({ error: 'quote_unavailable' }, { status: 502 })
  }
}

/** The tier the quote was signed under; it is part of the signed payload, so it must match. */
const EXPORT_QUOTE_TIER = 'export-unlock'

/**
 * The pinned minimum for this purchase, or a response explaining why it cannot be honoured.
 *
 * Deliberately not `resolveDirectorSettlementMinWei`: that helper takes the Director quote type,
 * whose tier is a premium/retail choice, while this quote is signed under its own tier. What is
 * checked here is the signature, and only that — see the closing comment.
 */
async function settlementMinWei(proof: ExportQuoteProof | null): Promise<bigint | Response> {
  if (!proof) {
    // No proof means the client threw the quote away; without it there is nothing to verify
    // the payment against, and re-pricing here is exactly the failure mode this route avoids.
    return Response.json({ error: 'quote_missing' }, { status: 409 })
  }

  const signed = {
    quoteId: proof.quoteId,
    signature: proof.signature,
    // Part of the signed payload, so it has to be the amount the quote was built from.
    estimatedUsdc6: EXPORT_UNLOCK_USDC6,
    minCrtvaiWei: BigInt(proof.minCrtvaiWei),
    expiresAtMs: proof.expiresAtMs,
    slippageBps: proof.slippageBps,
    tier: EXPORT_QUOTE_TIER,
  }

  // Without a secret, `signPayload` falls back to `unsigned:<payload>`, which anyone can forge.
  if (!isQuoteSigningConfigured() || proof.signature.startsWith('unsigned:')) {
    return Response.json(
      { error: 'payment_not_verified', reason: 'invalid_quote' },
      { status: 400 },
    )
  }
  if (!verifyQuoteSignature(signed)) {
    return Response.json(
      { error: 'payment_not_verified', reason: 'invalid_quote' },
      { status: 400 },
    )
  }

  // Whether the payment arrived inside the quote's window is a question about the transfer, not
  // the request: it is answered after the transfer is read (`settleWithinQuoteWindow`), so a
  // retry hours later is not rejected by the clock alone.
  return signed.minCrtvaiWei
}

/**
 * Accept the payment only if it was *mined* inside the window its quote was sold in.
 *
 * The quote's deadline exists to stop a stale price being paid later. A transfer that already
 * landed inside the window has passed that test, so a redemption retried days afterwards must
 * still succeed — refusing it would take the money and issue nothing, for a permit that is good
 * for a year. Freshness is re-checked only for a payment that arrived late or whose block time
 * we could not read.
 */
async function settleWithinQuoteWindow(input: {
  signed: { minCrtvaiWei: bigint; expiresAtMs: number; slippageBps: number }
  minedAtMs: number | undefined
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deadlineMs = input.signed.expiresAtMs + METOKEN_QUOTE_SETTLEMENT_GRACE_SECONDS * 1000
  if (input.minedAtMs !== undefined) {
    return input.minedAtMs <= deadlineMs
      ? { ok: true }
      : { ok: false, reason: 'Quote expired — request a new price.' }
  }

  try {
    await validateSettlementAgainstQuote({
      estimatedUsdc6: EXPORT_UNLOCK_USDC6,
      minCrtvaiWei: input.signed.minCrtvaiWei,
      expiresAtMs: input.signed.expiresAtMs,
      slippageBps: input.signed.slippageBps,
    })
    return { ok: true }
  } catch (error) {
    if (error instanceof MetokenQuoteError) return { ok: false, reason: error.message }
    throw error
  }
}

/** Verify the transfer, sign the permit, then spend the transfer that bought it. */
async function redeemPermit(input: {
  accountId: string
  projectId: string
  paymentTxHash: string
  signer: `0x${string}`
  payer: string
  quote: ExportQuoteProof | null
}): Promise<Response> {
  const minAmountWei = await settlementMinWei(input.quote)
  if (minAmountWei instanceof Response) return minAmountWei
  // Narrowed: `settlementMinWei` returning a number means the proof parsed and verified.
  const proof = input.quote as ExportQuoteProof

  const payerBinding = assertPaymentPayerMatchesSigner(input.payer, input.signer)
  if (!payerBinding.ok) {
    return Response.json(
      { error: 'payment_not_verified', reason: payerBinding.reason },
      { status: 403 },
    )
  }

  // Verified without being consumed: the claim below is the only thing allowed to spend this
  // transfer, because it is also the only thing that can re-issue it to the same buyer.
  const payment = await verifyDirectorPayment({
    txHash: input.paymentTxHash,
    from: input.payer,
    minAmountWei,
    verifiedSignerAddress: input.signer,
    includeMinedAt: true,
  })
  if (!payment.ok) {
    return Response.json({ error: 'payment_not_verified', reason: payment.reason }, { status: 402 })
  }

  const settlement = await settleWithinQuoteWindow({
    signed: {
      minCrtvaiWei: BigInt(proof.minCrtvaiWei),
      expiresAtMs: proof.expiresAtMs,
      slippageBps: proof.slippageBps,
    },
    minedAtMs: payment.blockTimestampMs,
  })
  if (!settlement.ok) {
    return Response.json(
      { error: 'payment_not_verified', reason: settlement.reason },
      { status: 402 },
    )
  }

  // Signed before the claim on purpose: an unconfigured signer must not burn the payment.
  let permit: { permit: string; expiresAtMs: number }
  try {
    permit = signExportPermit({
      accountId: input.accountId,
      projectId: input.projectId,
      txHash: input.paymentTxHash,
    })
  } catch (error) {
    if (error instanceof ExportPermitConfigError) {
      // Never sign an unsigned permit: it would be indistinguishable from a forged one.
      console.error('export permit signing is not configured')
      return Response.json({ error: 'permit_unavailable' }, { status: 503 })
    }
    throw error
  }

  // One transfer, one purchase. The purpose carries the project id, so a re-issue can only
  // ever restore the project that was paid for — never unlock a second one.
  const purpose = `export_unlock:${input.projectId}`
  let claim: { ok: true } | { ok: false; reason: string }
  try {
    claim = await claimPaymentTxLogForPurpose(input.paymentTxHash, payment.logIndex, {
      wallet: input.accountId,
      purpose,
      ttlSeconds: CLAIM_TTL_SECONDS,
    })
  } catch (error) {
    console.error('export permit ledger failed', error)
    return Response.json({ error: 'permit_unavailable' }, { status: 503 })
  }
  if (!claim.ok) {
    return Response.json({ error: 'payment_not_verified', reason: claim.reason }, { status: 402 })
  }

  return Response.json({
    permit: permit.permit,
    projectId: input.projectId,
    expiresAtMs: permit.expiresAtMs,
  })
}

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authenticateGenerativePost(request)
  if (!authenticated.ok) return authenticated.response
  const { body, signer, payer } = authenticated

  const limited = await checkPixelsRateLimits(request, 'quote', { ip: false, identity: signer })
  if (limited) return limited

  const req = parseRequest(body)
  if (!req) return Response.json({ error: 'invalid_project' }, { status: 400 })

  if (!req.paymentTxHash) return quoteResponse(req.projectId)

  return redeemPermit({
    accountId: signer.toLowerCase(),
    projectId: req.projectId,
    paymentTxHash: req.paymentTxHash,
    signer,
    payer,
    quote: req.quote,
  })
}
