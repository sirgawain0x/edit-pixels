/**
 * Where a Precision run gets its caller identity from.
 *
 * `POST /api/transcribe-precision` authenticates through `resolvePixelsIdentity`, which accepts a
 * Privy bearer token **or** `body.token` — and the client sent neither, so every run answered
 * `401 missing authorization`. The token comes from the wallet provider, which the transcription
 * service cannot reach: the same four callers that needed `precision-payment` are plain utility
 * modules with no React in scope. So it takes the same shape: one module-level slot, registered by
 * a hook that *is* inside the wallet, read by whoever makes the request.
 *
 * Unlike payment, a missing provider is not fatal here — a run still fails loudly with the server's
 * 401 — so the getter returns null and the client simply sends no header.
 */
export type PrecisionAccessTokenProvider = () => Promise<string | null>

let provider: PrecisionAccessTokenProvider | null = null

export function registerPrecisionAccessToken(fn: PrecisionAccessTokenProvider): () => void {
  provider = fn
  return () => {
    if (provider === fn) provider = null
  }
}

export async function getPrecisionAccessToken(): Promise<string | null> {
  if (!provider) return null
  try {
    const token = await provider()
    return token?.trim() ? token.trim() : null
  } catch {
    // A wallet that throws while minting a token must not turn into a different failure than
    // "not authenticated": let the request go out unauthenticated and let the route answer.
    return null
  }
}

/** Header value for an authenticated request. Built by joining, never by interpolation. */
export function bearerHeader(token: string): string {
  return ['Bearer', token].join(' ')
}

/**
 * Merge the caller identity into a request init.
 *
 * Every request this pipeline makes to our own API has to carry it: the quote, the upload-session
 * request, the per-part submit and the job poll all run through `authenticateGenerativePost`, and
 * fixing them one at a time is how the upload session kept answering 401 after the quote was
 * already authenticated. Call it through `authorizedPrecisionFetch` so a new endpoint cannot forget.
 *
 * Pre-signed GCS upload URLs must NOT go through this: their signature is the credential, and an
 * unexpected `Authorization` header is rejected.
 */
async function precisionRequestInit(init: RequestInit = {}): Promise<RequestInit> {
  const token = await getPrecisionAccessToken()
  if (!token) return init
  const existing = (init.headers ?? {}) as Record<string, string>
  return { ...init, headers: { ...existing, authorization: bearerHeader(token) } }
}

/** `fetch` for this pipeline's own API calls, carrying the caller identity. */
export async function authorizedPrecisionFetch(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetchImpl(input, await precisionRequestInit(init))
}
