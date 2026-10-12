import { readPayerAddress, resolvePixelsIdentity, resolvePixelsIdentityGet } from './_pixels-identity.js'
import { verifyFlowPayment } from './flow-billing.js'
import type { FlowCreditsQuote } from './flow-billing.js'

export async function authenticateGenerativePost(request: Request): Promise<
  | { ok: true; signer: `0x${string}`; payer: string; body: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const resolved = await resolvePixelsIdentity(request)
  if (!resolved.ok) return resolved
  const signer = resolved.identity.signer
  const payer = readPayerAddress(resolved.body) ?? signer
  return { ok: true, signer, payer, body: resolved.body }
}

export async function authenticateGenerativeGet(request: Request): Promise<
  | { ok: true; signer: `0x${string}` }
  | { ok: false; response: Response }
> {
  const resolved = await resolvePixelsIdentityGet(request)
  if (!resolved.ok) return resolved
  return { ok: true, signer: resolved.identity.signer }
}

export async function verifyGenerativeCrtvaiPayment(options: {
  paymentTxHash: string
  signer: `0x${string}`
  payer: string
  quote: Pick<FlowCreditsQuote, 'minCrtvaiWei'>
  purpose: string
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const verified = await verifyFlowPayment({
    txHash: options.paymentTxHash,
    from: options.payer,
    minAmountWei: options.quote.minCrtvaiWei,
    purpose: options.purpose,
    verifiedSignerAddress: options.signer,
  })
  if (!verified.ok) {
    return { ok: false, reason: verified.reason }
  }
  return { ok: true }
}
