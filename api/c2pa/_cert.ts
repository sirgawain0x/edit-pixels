/// <reference types="node" />
// fallow-ignore-file complexity
/**
 * C2PA wallet-challenge certificate issuance.
 *
 * Issues a per-wallet X.509 signing cert whose subject is `CN=did:ethr:<wallet>`,
 * gated behind an EIP-712 ownership proof. This is the honest identity binding:
 * the cert only asserts a wallet identity AFTER the wallet proves it controls
 * the address via `signTypedData` — no fabricated provenance claims.
 *
 * The cert is signed with the SAME ES256 key as the self-signed test cert
 * (C2PA_CERT_KEY), so the signing path in `sign.ts` is unchanged; only the
 * subject differs per wallet. This is a documented v1 simplification (one
 * shared key, per-wallet certs); move to per-wallet keys when joining the CAI
 * trust list.
 *
 * Storage: `certId → { certDer, keyPem, wallet, expiresAt }` in Redis (Upstash /
 * Vercel KV), so certs survive cold lambdas. `certId` is a random hex, NOT
 * derived from the wallet, so it can be revoked without leaking the address.
 */

import 'reflect-metadata'
import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto'
import * as x509 from '@peculiar/x509'
import { recoverTypedDataAddress } from 'viem'
import { getRedis } from '../_redis-client'
import { ADDRESS_REGEX, HEX_SIG_REGEX } from '../_address'

/** EIP-712 domain for the identity challenge (Base). */
const C2PA_DOMAIN = {
  name: 'Pixels C2PA',
  version: '1',
  chainId: 8453,
} as const

/** EIP-712 typed message the wallet signs to prove ownership. */
const C2PA_TYPES = {
  C2PAIdentityChallenge: [
    { name: 'wallet', type: 'address' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'expiresAt', type: 'uint256' },
  ],
} as const

const CHALLENGE_TTL_SECONDS = 5 * 60 // 5 minutes
const CERT_TTL_SECONDS = 90 * 24 * 60 * 60 // 90 days

const CERT_PREFIX = 'c2pa:cert:'
const CHALLENGE_PREFIX = 'c2pa:challenge:'

function hasSigningKey(): boolean {
  return Boolean(process.env.C2PA_CERT_KEY)
}

/** Generate a random 32-byte nonce as a 0x-prefixed hex string. */
function randomNonce(): `0x${string}` {
  return `0x${randomBytes(32).toString('hex')}` as `0x${string}`
}

/** Generate a random certId (not derived from the wallet). */
function randomCertId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Import the shared ES256 key (from C2PA_CERT_KEY) as a WebCrypto keypair so
 * @peculiar/x509 can sign a per-wallet cert with it.
 */
async function importSharedKey(): Promise<CryptoKeyPair> {
  const keyPem = process.env.C2PA_CERT_KEY as string
  const keyObj = createPrivateKey(keyPem)
  const pkcs8 = keyObj.export({ format: 'der', type: 'pkcs8' })
  const spki = createPublicKey(keyObj).export({ format: 'der', type: 'spki' })

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    // extractable: @peculiar/x509 must read the public key material to encode
    // the subjectPublicKeyInfo when minting the per-wallet cert.
    true,
    ['sign'],
  )
  const publicKey = await crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  )
  return { privateKey, publicKey }
}

/**
 * Issue a per-wallet self-signed cert with subject `CN=did:ethr:<wallet>`,
 * signed by the shared ES256 key. Returns DER bytes.
 */
async function issueWalletCert(wallet: string): Promise<Uint8Array> {
  const keys = await importSharedKey()
  const notBefore = new Date()
  const notAfter = new Date(Date.now() + CERT_TTL_SECONDS * 1000)

  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomBytes(16).toString('hex'),
    name: `CN=did:ethr:${wallet}`,
    notBefore,
    notAfter,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(false),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature),
    ],
  })

  return new Uint8Array(cert.rawData)
}

/** Issue a challenge nonce for a wallet and store it (one-time use). */
export async function issueChallenge(wallet: string): Promise<{
  nonce: `0x${string}`
  expiresAt: number
  domain: typeof C2PA_DOMAIN
  types: typeof C2PA_TYPES
}> {
  if (!ADDRESS_REGEX.test(wallet)) {
    throw new Error('invalid wallet')
  }
  const nonce = randomNonce()
  const expiresAt = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS

  const redis = await getRedis()
  if (!redis) {
    throw new Error('cert storage unavailable')
  }
  await redis.set(`${CHALLENGE_PREFIX}${wallet.toLowerCase()}`, nonce, {
    ex: CHALLENGE_TTL_SECONDS,
  })

  return { nonce, expiresAt, domain: C2PA_DOMAIN, types: C2PA_TYPES }
}

/**
 * Verify the EIP-712 ownership proof and issue a per-wallet cert.
 * Returns the certId (stored in Redis) on success.
 */
export async function verifyAndIssue(opts: {
  wallet: string
  signature: string
  nonce: string
  expiresAt: number
}): Promise<{ certId: string; expiresAt: number }> {
  const { wallet, signature, nonce, expiresAt } = opts

  if (!ADDRESS_REGEX.test(wallet)) throw new Error('invalid wallet')
  if (!HEX_SIG_REGEX.test(signature)) throw new Error('invalid signature')
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) throw new Error('invalid nonce')
  if (expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('challenge expired')

  // 1. Verify the nonce matches the one we issued (one-time use).
  const redis = await getRedis()
  if (!redis) {
    throw new Error('cert storage unavailable')
  }
  const stored = await redis.get<string>(`${CHALLENGE_PREFIX}${wallet.toLowerCase()}`)
  if (stored !== nonce) throw new Error('invalid or expired challenge')
  await redis.del(`${CHALLENGE_PREFIX}${wallet.toLowerCase()}`)

  // 2. Recover the signer from the EIP-712 signature and check it == wallet.
  const recovered = await recoverTypedDataAddress({
    domain: C2PA_DOMAIN,
    types: C2PA_TYPES,
    primaryType: 'C2PAIdentityChallenge',
    message: {
      wallet: wallet as `0x${string}`,
      nonce: nonce as `0x${string}`,
      expiresAt: BigInt(expiresAt),
    },
    signature: signature as `0x${string}`,
  })
  if (recovered.toLowerCase() !== wallet.toLowerCase()) {
    throw new Error('signature does not match wallet')
  }

  // 3. Issue the per-wallet cert.
  if (!hasSigningKey()) throw new Error('no signing key configured')
  const certDer = await issueWalletCert(wallet)
  const certId = randomCertId()
  const certExpiresAt = Math.floor(Date.now() / 1000) + CERT_TTL_SECONDS

  await redis.set(
    `${CERT_PREFIX}${certId}`,
    JSON.stringify({
      certDer: Buffer.from(certDer).toString('base64'),
      keyPem: process.env.C2PA_CERT_KEY as string,
      wallet: wallet.toLowerCase(),
      expiresAt: certExpiresAt,
    }),
    { ex: CERT_TTL_SECONDS },
  )

  return { certId, expiresAt: certExpiresAt }
}

/** Resolve a certId to its cert DER + key PEM (for the sign endpoint). */
export async function resolveCert(certId: string): Promise<{
  certDer: Uint8Array
  keyPem: string
} | null> {
  const redis = await getRedis()
  if (!redis) return null
  const raw = await redis.get<string>(`${CERT_PREFIX}${certId}`)
  if (!raw) return null
  const parsed = JSON.parse(raw) as { certDer: string; keyPem: string }
  return {
    certDer: new Uint8Array(Buffer.from(parsed.certDer, 'base64')),
    keyPem: parsed.keyPem,
  }
}
