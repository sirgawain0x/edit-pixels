/**
 * Signed permit that lets one project's exports drop the CRTV watermark.
 *
 * The permit exists because export runs in the browser: a bare `watermark: false` flag is a
 * DevTools toggle, while a permit is a server statement that this account paid for this
 * project. Nothing in the payload is secret — the signature is what makes it a claim the
 * client cannot make up.
 *
 * Deliberately project-scoped, matching the $5 price: buying a project must not unlock the
 * whole account, or the account-wide (more expensive) tier could be bought at project price.
 */
import { createHmac, timingSafeEqual } from 'crypto'

/** $5.00 in usdc6 — one project, once. */
export const EXPORT_UNLOCK_USDC6 = 5_000_000
export const EXPORT_UNLOCK_PRICE_USD = 5

/**
 * A year, not a session. The unlock is a purchase, so re-exporting next month must not charge
 * again; the client keeps the token and the server re-signs from the payment when asked.
 */
export const EXPORT_PERMIT_TTL_MS = 365 * 24 * 60 * 60 * 1000

/** `PIXELS_QUOTE_SIGNING_SECRET` is already the repo's quote-signing key; a second one would drift. */
function signingSecret(): string | null {
  const raw = process.env.PIXELS_QUOTE_SIGNING_SECRET?.trim()
  return raw && raw.length >= 16 ? raw : null
}

export class ExportPermitConfigError extends Error {
  constructor() {
    super('PIXELS_QUOTE_SIGNING_SECRET is not configured')
    this.name = 'ExportPermitConfigError'
  }
}

export interface ExportPermitPayload {
  /** Lower-cased owner. */
  accountId: string
  projectId: string
  /** The CRTVAI transfer that paid for it, so support can trace a permit back to a tx. */
  txHash: string
  issuedAtMs: number
  expiresAtMs: number
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

/**
 * Issue a permit.
 *
 * Throws when there is no secret rather than emitting an unsigned token: an unsigned permit is
 * indistinguishable from a forged one, and this is a paywall.
 */
export function signExportPermit(input: {
  accountId: string
  projectId: string
  txHash: string
  now?: number
}): { permit: string; expiresAtMs: number } {
  const secret = signingSecret()
  if (!secret) throw new ExportPermitConfigError()

  const issuedAtMs = input.now ?? Date.now()
  const payload: ExportPermitPayload = {
    accountId: input.accountId.toLowerCase(),
    projectId: input.projectId,
    txHash: input.txHash,
    issuedAtMs,
    expiresAtMs: issuedAtMs + EXPORT_PERMIT_TTL_MS,
  }

  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return { permit: `${body}.${sign(secret, body)}`, expiresAtMs: payload.expiresAtMs }
}

export type ExportPermitVerdict =
  | { ok: true; payload: ExportPermitPayload }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'wrong_account' | 'wrong_project' }

function sameBytes(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  // Length check first: timingSafeEqual throws on mismatched lengths.
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Verify a permit for exactly this account and project, at this moment. */
export function verifyExportPermit(
  permit: string,
  expected: { accountId: string; projectId: string; now?: number },
): ExportPermitVerdict {
  const secret = signingSecret()
  if (!secret) return { ok: false, reason: 'signature' }

  const dot = permit.indexOf('.')
  if (dot <= 0) return { ok: false, reason: 'malformed' }

  const body = permit.slice(0, dot)
  const signature = permit.slice(dot + 1)
  if (!sameBytes(sign(secret, body), signature)) return { ok: false, reason: 'signature' }

  let payload: ExportPermitPayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ExportPermitPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const now = expected.now ?? Date.now()
  if (typeof payload.expiresAtMs !== 'number' || payload.expiresAtMs <= now) {
    return { ok: false, reason: 'expired' }
  }
  if (payload.accountId !== expected.accountId.toLowerCase()) {
    return { ok: false, reason: 'wrong_account' }
  }
  if (payload.projectId !== expected.projectId) return { ok: false, reason: 'wrong_project' }

  return { ok: true, payload }
}
