/**
 * C2PA signing client — the network boundary to the remote signing service.
 *
 * The browser cannot sign C2PA manifests (no X.509 key in the client), so the
 * export worker POSTs the rendered blob + manifest template to a serverless
 * endpoint that holds the signing cert and returns the re-signed file.
 *
 * Signing is OPTIONAL and NON-FATAL: any failure here returns `null` and the
 * caller falls back to the unsigned blob.
 */

import type { C2paManifestTemplate } from './c2pa-manifest'

const SIGN_ENDPOINT = '/api/c2pa/sign'

export interface C2paSignResult {
  /** The re-signed file bytes (JUMBF box injected). */
  blob: Blob
  /** Manifest URL for provenance lookup (may be empty for embedded-only). */
  manifestUrl?: string
}

/**
 * Sign an export blob via the remote service (embedded mode).
 * Returns `null` on any failure so the export can proceed unsigned.
 */
export async function signExportBlob(opts: {
  blob: Blob
  manifest: C2paManifestTemplate
  wallet?: string
  signal?: AbortSignal
}): Promise<C2paSignResult | null> {
  try {
    const form = new FormData()
    form.append('file', opts.blob)
    form.append('manifest', JSON.stringify(opts.manifest))
    if (opts.wallet) form.append('wallet', opts.wallet)

    const res = await fetch(SIGN_ENDPOINT, {
      method: 'POST',
      body: form,
      signal: opts.signal,
    })

    if (!res.ok) return null

    const signedBlob = await res.blob()
    if (signedBlob.size === 0) return null

    const manifestUrl = res.headers.get('x-c2pa-manifest-url') ?? undefined
    return { blob: signedBlob, manifestUrl }
  } catch {
    // Non-fatal: signing is best-effort.
    return null
  }
}
