/// <reference types="node" />
// fallow-ignore-file complexity
/**
 * C2PA wallet-challenge: verify the EIP-712 proof and issue a per-wallet cert.
 *
 *   POST /api/c2pa/certs   { wallet, signature, nonce, expiresAt } → { certId, expiresAt }
 *
 * The client signs the EIP-712 challenge on the main thread (Privy EOA), then
 * exchanges the signature for a per-wallet certId. The export worker only ever
 * receives the opaque certId — never the wallet address or signature.
 */

import { verifyAndIssue } from './_cert'

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Expected JSON body' }, { status: 400 })
  }

  const wallet = typeof body.wallet === 'string' ? body.wallet : ''
  const signature = typeof body.signature === 'string' ? body.signature : ''
  const nonce = typeof body.nonce === 'string' ? body.nonce : ''
  const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : 0

  try {
    const result = await verifyAndIssue({ wallet, signature, nonce, expiresAt })
    return Response.json(result)
  } catch (e) {
    const msg = (e as Error).message
    const status = msg.includes('unavailable')
      ? 503
      : msg.includes('expired') || msg.includes('challenge')
        ? 400
        : 401
    return Response.json({ error: msg }, { status })
  }
}
