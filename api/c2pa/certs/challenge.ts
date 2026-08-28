/// <reference types="node" />
// fallow-ignore-file complexity
/**
 * C2PA wallet-challenge: request a challenge nonce.
 *
 *   POST /api/c2pa/certs/challenge   { wallet } → { nonce, expiresAt, domain, types }
 *
 * The client signs the EIP-712 challenge on the main thread (Privy EOA), then
 * exchanges the signature for a per-wallet certId via POST /api/c2pa/certs.
 */

import { issueChallenge } from '../_cert'

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Expected JSON body' }, { status: 400 })
  }

  const wallet = typeof body.wallet === 'string' ? body.wallet : ''
  try {
    const challenge = await issueChallenge(wallet)
    return Response.json(challenge)
  } catch (e) {
    const msg = (e as Error).message
    const status = msg.includes('unavailable') ? 503 : 400
    return Response.json({ error: msg }, { status })
  }
}
