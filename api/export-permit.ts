/**
 * POST /api/export-permit
 *
 * Two modes, distinguished by whether a payment hash arrives:
 *
 * - **quote** (no `paymentTxHash`): how much CRTVAI removes the watermark for this project.
 *   Priced at $5.00 and converted at the live curve rate, so the dollar price holds while
 *   CRTVAI moves.
 * - **redeem** (`paymentTxHash` present): verify the transfer, then sign a permit bound to
 *   this account and project.
 *
 * One route rather than two because the price is fixed: a separate quote endpoint would add a
 * round trip and a second rate-limit class for a constant.
 */
import { checkPixelsRateLimits } from './_rate-limit.js'
import {
  authenticateGenerativePost,
  verifyGenerativeCrtvaiPayment,
} from './_pixels-generate-route-auth.js'
import { quoteCrtvaiForUsdc6 } from './_metoken-curve-quote.js'
import { claimPaymentTxLogForPurpose } from './_payment-ledger.js'
import {
  EXPORT_UNLOCK_PRICE_USD,
  EXPORT_UNLOCK_USDC6,
  ExportPermitConfigError,
  signExportPermit,
} from './_export-permit.js'

/** Project ids are opaque to us; long enough for a UUID, short enough to refuse junk. */
const MAX_PROJECT_ID_LENGTH = 128

interface PermitRequest {
  projectId: string
  paymentTxHash: string | null
}

function parseRequest(body: Record<string, unknown>): PermitRequest | null {
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
  if (!projectId || projectId.length > MAX_PROJECT_ID_LENGTH) return null

  const txHash = typeof body.paymentTxHash === 'string' ? body.paymentTxHash.trim() : ''
  return { projectId, paymentTxHash: txHash.length > 0 ? txHash : null }
}

/** What removing the mark costs right now, converted on the same curve every paid feature uses. */
async function quoteResponse(projectId: string): Promise<Response> {
  try {
    const quote = await quoteCrtvaiForUsdc6(EXPORT_UNLOCK_USDC6, { tier: 'export-unlock' })
    return Response.json({
      projectId,
      priceUsd: EXPORT_UNLOCK_PRICE_USD,
      estimatedUsdc6: EXPORT_UNLOCK_USDC6,
      minCrtvaiWei: quote.minCrtvaiWei.toString(),
      expiresAtMs: quote.expiresAtMs,
    })
  } catch (error) {
    console.error('export permit quote failed', error)
    return Response.json({ error: 'quote_unavailable' }, { status: 502 })
  }
}

/** Verify the transfer, spend it once, and sign the permit it bought. */
async function redeemPermit(input: {
  accountId: string
  projectId: string
  paymentTxHash: string
  signer: `0x${string}`
  payer: string
}): Promise<Response> {
  // Re-quote at redemption time so the minimum matches what the wallet was asked for on the
  // same curve state; a stale client price would otherwise fail verification for no good reason.
  let minCrtvaiWei: string
  try {
    const quote = await quoteCrtvaiForUsdc6(EXPORT_UNLOCK_USDC6, { tier: 'export-unlock' })
    minCrtvaiWei = quote.minCrtvaiWei.toString()
  } catch (error) {
    console.error('export permit re-quote failed', error)
    return Response.json({ error: 'quote_unavailable' }, { status: 502 })
  }

  const purpose = `export_unlock:${input.projectId}`
  const payment = await verifyGenerativeCrtvaiPayment({
    paymentTxHash: input.paymentTxHash,
    signer: input.signer,
    payer: input.payer,
    quote: { minCrtvaiWei: BigInt(minCrtvaiWei) },
    // The project id is part of what was bought, so it is part of the purpose the verifier sees.
    purpose,
  })
  if (!payment.ok) {
    return Response.json({ error: 'payment_not_verified', reason: payment.reason }, { status: 402 })
  }

  // A verified transfer is not yet a spent one. Without this claim the same $5 could mint a
  // permit for every project in turn; the `purpose` in the ledger keeps a re-issued permit
  // scoped to the one project that was actually paid for.
  let claim: { ok: true } | { ok: false; reason: string }
  try {
    claim = await claimPaymentTxLogForPurpose(input.paymentTxHash, payment.logIndex, {
      wallet: input.accountId,
      purpose,
    })
  } catch (error) {
    console.error('export permit ledger failed', error)
    return Response.json({ error: 'permit_unavailable' }, { status: 503 })
  }
  if (!claim.ok) {
    return Response.json({ error: 'payment_not_verified', reason: claim.reason }, { status: 402 })
  }

  try {
    const { permit, expiresAtMs } = signExportPermit({
      accountId: input.accountId,
      projectId: input.projectId,
      txHash: input.paymentTxHash,
    })
    return Response.json({ permit, projectId: input.projectId, expiresAtMs })
  } catch (error) {
    if (error instanceof ExportPermitConfigError) {
      // Never sign an unsigned permit: it would be indistinguishable from a forged one.
      console.error('export permit signing is not configured')
      return Response.json({ error: 'permit_unavailable' }, { status: 503 })
    }
    throw error
  }
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
  })
}
