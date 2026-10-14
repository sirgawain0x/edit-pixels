/// <reference types="node" />
/**
 * Privy-backed authorization for GET /api/director-sessions.
 * Rate limits in #185 should key on `verifiedSigner`, never raw `?wallet=`.
 */
import { getAddress } from 'viem'
import { assertPaymentPayerMatchesSigner } from './_pixels-payment-payer.js'
import { resolvePixelsIdentityGet } from './_pixels-identity.js'

/** Accept any 0x/0X + 40 hex chars; normalize to checksummed address for comparisons. */
export function normalizeDirectorSessionsWallet(raw: string): string | null {
  const trimmed = raw.trim()
  if (!/^0x[a-fA-F0-9]{40}$/i.test(trimmed)) return null
  return getAddress(`0x${trimmed.slice(2).toLowerCase()}`)
}

export async function authorizeDirectorSessionsGet(
  request: Request,
  walletAddress: string,
): Promise<
  | { ok: true; verifiedSigner: `0x${string}` }
  | { ok: false; response: Response }
> {
  const identity = await resolvePixelsIdentityGet(request)
  if (!identity.ok) return identity

  const payerMatch = assertPaymentPayerMatchesSigner(walletAddress, identity.identity.signer)
  if (!payerMatch.ok) {
    return {
      ok: false,
      response: Response.json({ error: payerMatch.reason }, { status: 403 }),
    }
  }

  return { ok: true, verifiedSigner: identity.identity.signer }
}
