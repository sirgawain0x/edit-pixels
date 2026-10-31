/// <reference types="node" />
/**
 * Pixels generate / Director / Flow identity: active Privy-linked signer EOA.
 */
// fallow-ignore-file complexity

import { PrivyClient } from '@privy-io/server-auth'
import { isDirectorSecretAllowlistedSigner, isDirectorSecretAuthorized } from './_director-auth.js'
import { getBearerToken, getPrivyAuth } from './_wallet-auth.js'
import { parseJsonObjectBody } from './_pixels-json-body.js'

export const PIXELS_SIGNER_HEADER = 'x-pixels-signer'

export type PixelsIdentitySource = 'privy' | 'secret'

export interface PixelsIdentity {
  signer: `0x${string}`
  source: PixelsIdentitySource
}

export type ResolvePixelsIdentityResult =
  | { ok: true; identity: PixelsIdentity; body: Record<string, unknown> }
  | { ok: false; response: Response }

let privyClient: PrivyClient | null = null

function getPrivyClient(): PrivyClient | null {
  if (!privyClient) {
    const auth = getPrivyAuth()
    if (!auth) return null
    privyClient = new PrivyClient(auth.appId, auth.appSecret)
  }
  return privyClient
}

function isWalletWithAddress(account: unknown): account is { address: string } {
  return (
    typeof account === 'object' &&
    account !== null &&
    'address' in account &&
    typeof (account as { address: unknown }).address === 'string' &&
    (account as { address: string }).address.startsWith('0x')
  )
}

function normalizeSignerAddress(raw: string): `0x${string}` | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('0x') || trimmed.length < 42) return null
  return trimmed.toLowerCase() as `0x${string}`
}

export function readSignerHint(
  request: Request,
  body?: Record<string, unknown>,
): string | undefined {
  const header = request.headers.get(PIXELS_SIGNER_HEADER)?.trim()
  if (header) return header
  if (body) {
    if (typeof body.signerAddress === 'string') return body.signerAddress.trim()
    if (typeof body.signer_address === 'string') return body.signer_address.trim()
  }
  const url = new URL(request.url)
  const signer =
    url.searchParams.get('signer')?.trim() ||
    url.searchParams.get('signerAddress')?.trim() ||
    url.searchParams.get('wallet')?.trim()
  return signer || undefined
}

export function readPayerAddress(body: Record<string, unknown>): string | undefined {
  if (typeof body.payerAddress === 'string') return body.payerAddress.trim()
  if (typeof body.payer_address === 'string') return body.payer_address.trim()
  return undefined
}

async function listLinkedSignerAddresses(userId: string): Promise<`0x${string}`[]> {
  const client = getPrivyClient()
  if (!client) return []
  const user = await client.getUserById(userId)
  if (!user) return []
  return user.linkedAccounts
    .filter((a) => a.type === 'wallet' && isWalletWithAddress(a))
    .map((w) => (w as { address: string }).address.toLowerCase() as `0x${string}`)
}

export async function resolvePrivySignerFromToken(
  token: string,
  hint?: string,
): Promise<
  | { ok: true; signer: `0x${string}` }
  | { ok: false; response: Response }
> {
  const client = getPrivyClient()
  if (!client) {
    return {
      ok: false,
      response: Response.json({ error: 'invalid authorization' }, { status: 401 }),
    }
  }

  try {
    const claims = await client.verifyAuthToken(token)
    if (!claims?.userId) {
      return {
        ok: false,
        response: Response.json({ error: 'invalid authorization' }, { status: 401 }),
      }
    }

    const linked = await listLinkedSignerAddresses(claims.userId)
    if (!linked.length) {
      return {
        ok: false,
        response: Response.json({ error: 'invalid authorization' }, { status: 401 }),
      }
    }

    if (hint) {
      const normalized = normalizeSignerAddress(hint)
      if (!normalized) {
        return {
          ok: false,
          response: Response.json({ error: 'invalid signerAddress' }, { status: 400 }),
        }
      }
      if (!linked.includes(normalized)) {
        return {
          ok: false,
          response: Response.json({ error: 'signer not linked to this account' }, { status: 403 }),
        }
      }
      return { ok: true, signer: normalized }
    }

    if (linked.length === 1) {
      return { ok: true, signer: linked[0] }
    }

    return {
      ok: false,
      response: Response.json(
        { error: 'signerAddress required when multiple wallets are linked' },
        { status: 400 },
      ),
    }
  } catch {
    return {
      ok: false,
      response: Response.json({ error: 'invalid authorization' }, { status: 401 }),
    }
  }
}

function readDirectorSecretPrivyToken(body: Record<string, unknown>): string | null {
  if (typeof body.token !== 'string') return null
  const trimmed = body.token.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function resolveDirectorSecretIdentity(
  request: Request,
  body: Record<string, unknown>,
): Promise<ResolvePixelsIdentityResult> {
  const signerHint = readSignerHint(request, body)
  const signer = signerHint ? normalizeSignerAddress(signerHint) : null
  if (signerHint && !signer) {
    return {
      ok: false,
      response: Response.json({ error: 'invalid signerAddress' }, { status: 400 }),
    }
  }

  if (signer && isDirectorSecretAllowlistedSigner(signer)) {
    return { ok: true, identity: { signer, source: 'secret' }, body }
  }

  const privyToken = readDirectorSecretPrivyToken(body)
  if (!signer) {
    if (!privyToken) {
      return {
        ok: false,
        response: Response.json({ error: 'signerAddress required' }, { status: 400 }),
      }
    }
    const privy = await resolvePrivySignerFromToken(privyToken)
    if (!privy.ok) return privy
    return { ok: true, identity: { signer: privy.signer, source: 'secret' }, body }
  }

  if (!privyToken) {
    console.warn('director secret path rejected: missing privy token for non-allowlisted signer')
    return {
      ok: false,
      response: Response.json({ error: 'invalid authorization' }, { status: 403 }),
    }
  }

  const privy = await resolvePrivySignerFromToken(privyToken, signerHint)
  if (!privy.ok) return privy
  if (privy.signer !== signer) {
    console.warn('director secret path rejected: signer not linked to privy account')
    return {
      ok: false,
      response: Response.json({ error: 'signer not linked to this account' }, { status: 403 }),
    }
  }

  return { ok: true, identity: { signer, source: 'secret' }, body }
}

async function resolvePixelsIdentityFromBody(
  request: Request,
  body: Record<string, unknown>,
  options: { allowDirectorSecret?: boolean } = {},
): Promise<ResolvePixelsIdentityResult> {
  if (options.allowDirectorSecret && isDirectorSecretAuthorized(request)) {
    return resolveDirectorSecretIdentity(request, body)
  }

  const token = getBearerToken(request) || (typeof body.token === 'string' ? body.token : null)
  if (!token) {
    return {
      ok: false,
      response: Response.json({ error: 'missing authorization' }, { status: 401 }),
    }
  }

  const hint = readSignerHint(request, body)
  const privy = await resolvePrivySignerFromToken(token, hint)
  if (!privy.ok) return privy
  return {
    ok: true,
    identity: { signer: privy.signer, source: 'privy' },
    body,
  }
}

export async function resolvePixelsIdentity(
  request: Request,
  options: { allowDirectorSecret?: boolean } = {},
): Promise<ResolvePixelsIdentityResult> {
  const parsed = await parseJsonObjectBody(request)
  if (!parsed.ok) return parsed
  return resolvePixelsIdentityFromBody(request, parsed.body, options)
}

export async function resolvePixelsIdentityGet(
  request: Request,
): Promise<
  | { ok: true; identity: PixelsIdentity }
  | { ok: false; response: Response }
> {
  const token = getBearerToken(request)
  if (!token) {
    return {
      ok: false,
      response: Response.json({ error: 'missing authorization' }, { status: 401 }),
    }
  }
  const hint = readSignerHint(request)
  const privy = await resolvePrivySignerFromToken(token, hint)
  if (!privy.ok) return privy
  return { ok: true, identity: { signer: privy.signer, source: 'privy' } }
}
