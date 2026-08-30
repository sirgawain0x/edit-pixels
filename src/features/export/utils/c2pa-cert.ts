/**
 * C2PA wallet-challenge cert issuance client (main thread only).
 *
 * The export worker can't sign — the Privy EOA's `signTypedData` lives on the
 * main thread. So the identity proof happens here, before the render job is
 * enqueued, and only the opaque `certId` is threaded into the worker.
 *
 * Flow (option a, locked with the signing-service owner):
 *
 *   1. POST /api/c2pa/certs/challenge  { wallet } → { nonce, expiresAt, domain, types }
 *   2. walletClient.signTypedData(EIP-712 challenge) → signature
 *   3. POST /api/c2pa/certs  { wallet, signature, nonce, expiresAt } → { certId }
 *
 * The certId is cached per-wallet for the session so a cert isn't re-issued
 * (and a signature re-prompted) on every export. Non-fatal: any failure returns
 * `null` and the export falls back to the shared test cert (or unsigned).
 */

import type { TypedDataDomain, WalletClient } from 'viem'

const CHALLENGE_ENDPOINT = '/api/c2pa/certs/challenge'
const CERTS_ENDPOINT = '/api/c2pa/certs'

interface ChallengeResponse {
  nonce: `0x${string}`
  expiresAt: number
  domain: TypedDataDomain
  types: Record<string, Array<{ name: string; type: string }>>
}

interface CertsResponse {
  certId: string
  expiresAt: number
}

// Session-scoped cache: wallet → certId (with expiry). The certId is opaque
// and revocable, so caching it client-side is safe; it just avoids re-issuing.
const certIdCache = new Map<string, { certId: string; expiresAt: number }>()

/**
 * Obtain a per-wallet C2PA certId, proving wallet ownership via EIP-712.
 * Returns `null` on any failure (no wallet, sign rejected, service down).
 */
export async function getC2paCertId(
  wallet: string | undefined,
  walletClient: WalletClient | null,
): Promise<string | null> {
  if (!wallet || !walletClient) return null

  const key = wallet.toLowerCase()
  const cached = certIdCache.get(key)
  if (cached && cached.expiresAt > Math.floor(Date.now() / 1000)) {
    return cached.certId
  }

  try {
    // 1. Request a challenge nonce.
    const challengeRes = await fetch(CHALLENGE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet }),
    })
    if (!challengeRes.ok) return null
    const challenge = (await challengeRes.json()) as ChallengeResponse

    // 2. Sign the EIP-712 challenge on the main thread (Privy EOA — no
    //    EIP-1271/ERC-6492 wrapping, so recoverTypedDataAddress == wallet).
    const signature = await walletClient.signTypedData({
      account: wallet as `0x${string}`,
      domain: challenge.domain,
      types: challenge.types,
      primaryType: 'C2PAIdentityChallenge',
      message: {
        wallet,
        nonce: challenge.nonce,
        expiresAt: BigInt(challenge.expiresAt),
      },
    })

    // 3. Exchange the signature for a per-wallet certId.
    const certsRes = await fetch(CERTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet,
        signature,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt,
      }),
    })
    if (!certsRes.ok) return null
    const result = (await certsRes.json()) as CertsResponse

    certIdCache.set(key, { certId: result.certId, expiresAt: result.expiresAt })
    return result.certId
  } catch {
    return null
  }
}

/** Clear the session certId cache (tests only). */
export function clearC2paCertIdCache(): void {
  certIdCache.clear()
}
