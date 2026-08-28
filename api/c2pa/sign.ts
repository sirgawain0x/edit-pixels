/// <reference types="node" />
// fallow-ignore-file complexity
/**
 * C2PA signing endpoint (claim-signing mode).
 *
 * The browser cannot sign C2PA manifests (no X.509 key client-side), and the
 * full export blob can't round-trip through a Vercel serverless function
 * (4.5 MB request-body cap). So this route signs only the *claim* — a few KB —
 * and the worker embeds the returned COSE signature locally via `c2pa-web`.
 *
 * Contract (locked with the signing-service owner):
 *
 *   POST /api/c2pa/sign
 *   X-C2PA-Wallet: 0x…            (cert resolution; self-signed phase ignores it)
 *   Content-Type: application/octet-stream
 *   Body: <toBeSigned claim bytes>
 *
 *   → 200, application/octet-stream
 *     Body: <COSE_Sign1 CBOR>  (tag 18, protected {1:-7, 33:[certDER]},
 *                               detached payload, P1363 raw r‖s signature)
 *
 * The signature is computed over the COSE Sig_structure
 * `["Signature1", protected, b"", claimBytes]`, NOT the claim bytes directly.
 *
 * IDENTITY BINDING (correctness-critical): the cert's subject MUST equal the
 * manifest's author `did:ethr:<wallet>` (or a matching SAN), or a strict
 * validator flags a signer/author identity mismatch. The self-signed test cert
 * uses the zero address as a placeholder subject; wallet-challenge issuance
 * will mint per-wallet certs with `CN=did:ethr:<actual wallet>`.
 */

import { createPrivateKey, sign as cryptoSign } from 'node:crypto'
import {
  bstr,
  buildCoseSign1,
  buildProtectedHeader,
  buildSigStructure,
  normalizePem,
  pemToDer,
} from '../_cose'

const MAX_CLAIM_BYTES = 1024 * 1024 // 1 MiB guard — claims are a few KB

function hasSigningCert(): boolean {
  return Boolean(process.env.C2PA_CERT_PEM && process.env.C2PA_CERT_KEY)
}

export async function POST(request: Request): Promise<Response> {
  if (!hasSigningCert()) {
    return Response.json(
      { error: 'C2PA signing not configured: no signing certificate provisioned' },
      { status: 503 },
    )
  }

  const wallet = request.headers.get('x-c2pa-wallet') ?? ''
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return Response.json({ error: 'Missing or invalid X-C2PA-Wallet header' }, { status: 400 })
  }

  let claimBytes: Uint8Array
  try {
    const buf = new Uint8Array(await request.arrayBuffer())
    if (buf.length === 0) {
      return Response.json({ error: 'Empty claim body' }, { status: 400 })
    }
    if (buf.length > MAX_CLAIM_BYTES) {
      return Response.json({ error: 'Claim too large' }, { status: 413 })
    }
    claimBytes = buf
  } catch {
    return Response.json({ error: 'Expected raw claim bytes' }, { status: 400 })
  }

  try {
    const certPem = normalizePem(process.env.C2PA_CERT_PEM as string)
    const keyPem = normalizePem(process.env.C2PA_CERT_KEY as string)

    const certDer = pemToDer(certPem)
    const privateKey = createPrivateKey(keyPem)

    // 1. Protected header: { 1: -7 (ES256), 33: <cert DER> }.
    const protectedHeader = buildProtectedHeader(certDer)
    const protectedBstr = bstr(protectedHeader)

    // 2. Sig_structure = ["Signature1", protected, b"", claimBytes].
    const sigStructure = buildSigStructure(protectedBstr, claimBytes)

    // 3. ES256 sign the Sig_structure → raw P1363 r‖s (64 bytes for P-256).
    const signature = cryptoSign('sha256', sigStructure, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    })

    // 4. Assemble the COSE_Sign1 (tag 18, detached payload).
    const coseSign1 = buildCoseSign1({
      protectedBstr,
      signature: new Uint8Array(signature),
    })

    return new Response(new Uint8Array(coseSign1), {
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  } catch (e) {
    console.error('C2PA signing error', e)
    return Response.json({ error: 'C2PA signing failed' }, { status: 500 })
  }
}
