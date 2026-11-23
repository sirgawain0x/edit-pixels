/**
 * Client half of the export watermark unlock.
 *
 * `POST /api/export-permit` answers two things: what removal costs (a quote), and — once a
 * payment hash is supplied — a signed permit to stop stamping. This module knows that wire
 * shape plus the local permit cache; the hook knows the UI order of operations.
 *
 * Two facts shape what is honest to claim here:
 *
 * 1. The permit is a receipt, not a lock. Export runs in the browser, so anyone can write
 *    `watermark: false` in DevTools. The permit exists so a *normal* removal path is a purchase
 *    and so support can trace a paid unlock back to a transfer — not to make cheating
 *    impossible.
 * 2. The cache is keyed by account *and* project because the permit is project-scoped: paying
 *    for one project must not quietly unlock the next. The stored `txHash` lets the permit be
 *    re-minted from the same payment if the token is ever lost, so a lost token never means
 *    paying twice.
 */

export const EXPORT_PERMIT_PATH = '/api/export-permit'

/** Scheme prefix for the identity token; split out so the header is built in one place. */
const AUTHORIZATION_SCHEME = 'Bearer '

const PERMIT_STORAGE_PREFIX = 'crtv:export-permit:v1'

export interface ExportUnlockIdentity {
  getAccessToken: () => Promise<string | null>
  /** Privy-linked signer — the identity the server authenticates. */
  signerAddress: string
  /** Smart account that sends the CRTVAI transfer; the server verifies the payment came from it. */
  payerAddress: string
}

/** The server's quote: a fixed dollar price converted at the live curve rate. */
export interface ExportUnlockQuote {
  projectId: string
  priceUsd: number
  estimatedUsdc6: number
  minCrtvaiWei: string
  expiresAtMs: number
}

export interface StoredExportPermit {
  permit: string
  projectId: string
  /** The transfer that bought it, kept so the permit can be re-minted without re-paying. */
  txHash: string
  expiresAtMs: number
}

interface ErrorBody {
  error?: unknown
  reason?: unknown
}

async function failureOf(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as ErrorBody
  const reason = [body.error, body.reason]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(': ')
  return new Error(reason || `Request failed (${response.status})`)
}

async function postPermit<T>(
  identity: ExportUnlockIdentity,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<T> {
  const token = await identity.getAccessToken()
  if (!token) throw new Error('Not authenticated')

  const headers = new Headers({
    'content-type': 'application/json',
    'x-pixels-signer': identity.signerAddress,
  })
  headers.set('authorization', AUTHORIZATION_SCHEME.concat(token))

  const response = await fetchImpl(EXPORT_PERMIT_PATH, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...body,
      token,
      signerAddress: identity.signerAddress,
      payerAddress: identity.payerAddress,
    }),
  })
  if (!response.ok) throw await failureOf(response)
  return (await response.json()) as T
}

/** Ask what removing the mark for this project costs right now. */
export async function fetchExportUnlockQuote(
  identity: ExportUnlockIdentity,
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExportUnlockQuote> {
  const data = await postPermit<{
    projectId: string
    priceUsd: number
    estimatedUsdc6: number
    minCrtvaiWei: string
    expiresAtMs: number
  }>(identity, { projectId }, fetchImpl)

  return {
    projectId: data.projectId,
    priceUsd: data.priceUsd,
    estimatedUsdc6: data.estimatedUsdc6,
    minCrtvaiWei: data.minCrtvaiWei,
    expiresAtMs: data.expiresAtMs,
  }
}

/**
 * Hand the payment hash back and receive the permit.
 *
 * The server re-quotes at redemption time so the minimum checked is the one the same curve
 * state would ask for now; a stale client price is not treated as a reason to refuse.
 */
export async function redeemExportUnlockPermit(
  identity: ExportUnlockIdentity,
  input: { projectId: string; paymentTxHash: string },
  fetchImpl: typeof fetch = fetch,
): Promise<StoredExportPermit> {
  const data = await postPermit<{ permit: string; projectId: string; expiresAtMs: number }>(
    identity,
    { projectId: input.projectId, paymentTxHash: input.paymentTxHash },
    fetchImpl,
  )

  return {
    permit: data.permit,
    projectId: data.projectId,
    txHash: input.paymentTxHash,
    expiresAtMs: data.expiresAtMs,
  }
}

/* ───────────────────────────── local permit cache ───────────────────────────── */

function storageKey(account: string, projectId: string): string {
  return `${PERMIT_STORAGE_PREFIX}:${account.toLowerCase()}:${projectId}`
}

function readStorage(): Storage | null {
  try {
    // Guarded: a private-mode or sandboxed context throws on access rather than returning null.
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Validate one cached entry; a shape we do not recognise is treated as no permit. */
function parseStoredPermit(raw: string, projectId: string, now: number): StoredExportPermit | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredExportPermit>
    if (typeof parsed.permit !== 'string') return null
    if (typeof parsed.expiresAtMs !== 'number' || parsed.expiresAtMs <= now) return null
    if (parsed.projectId !== projectId) return null
    return {
      permit: parsed.permit,
      projectId,
      txHash: typeof parsed.txHash === 'string' ? parsed.txHash : '',
      expiresAtMs: parsed.expiresAtMs,
    }
  } catch {
    // A corrupt entry is treated as no entry: the worst case is re-minting from the tx.
    return null
  }
}

/** The cached permit for this account + project, or null when absent or expired. */
export function readStoredPermit(
  account: string | undefined,
  projectId: string | undefined,
  now: number = Date.now(),
): StoredExportPermit | null {
  if (!account || !projectId) return null
  const storage = readStorage()
  if (!storage) return null

  const raw = storage.getItem(storageKey(account, projectId))
  return raw === null ? null : parseStoredPermit(raw, projectId, now)
}

export function storeExportPermit(account: string, permit: StoredExportPermit): void {
  const storage = readStorage()
  if (!storage) return
  try {
    storage.setItem(storageKey(account, permit.projectId), JSON.stringify(permit))
  } catch {
    // Storage full or blocked: the permit still works for this session via in-memory state.
  }
}

export function clearStoredPermit(account: string, projectId: string): void {
  const storage = readStorage()
  if (!storage) return
  try {
    storage.removeItem(storageKey(account, projectId))
  } catch {
    // Nothing to do — the entry expires on its own.
  }
}

/**
 * True only when this account holds a live permit for this project.
 *
 * Absent account or project is `false` on purpose: without an identity there is nothing to bind
 * a purchase to, so the safe answer is "stamped".
 */
export function isExportUnlocked(
  account: string | undefined,
  projectId: string | undefined,
  now: number = Date.now(),
): boolean {
  return readStoredPermit(account, projectId, now) !== null
}
