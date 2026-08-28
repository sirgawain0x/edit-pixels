/**
 * C2PA signing client — the browser-side embed step.
 *
 * The browser cannot hold the signing key, and the full export blob can't
 * round-trip through a Vercel serverless function (4.5 MB request-body cap).
 * So the flow is:
 *
 *   1. Build the manifest locally with `c2pa-web`'s `Builder` (ingredients,
 *      actions, author identity).
 *   2. Sign via a `CallbackSigner` that POSTs only the *claim* bytes (a few KB)
 *      to `/api/c2pa/sign` and receives the complete COSE Sign1 structure back.
 *   3. `c2pa-web` embeds the signed manifest (JUMBF box) into the MP4/MOV
 *      locally and returns the signed asset bytes.
 *
 * Signing is OPTIONAL and NON-FATAL: any failure returns `null` and the caller
 * falls back to the unsigned blob.
 *
 * NOTE: `c2pa-web`'s wasm signer sets `direct_cose_handling = true`, so the
 * callback's `sign()` must return the FULL COSE Sign1 structure (not a raw
 * signature). The service builds that structure; this client just relays the
 * claim bytes and returns the service's bytes verbatim.
 */

import type { CompositionInputProps } from '@/types/export'
import type { Signer } from '@contentauth/c2pa-web'
import { collectIngredientSources } from './c2pa-manifest'

const SIGN_ENDPOINT = '/api/c2pa/sign'

// Reserve for the full COSE Sign1 structure: the cert (~700–800 bytes DER) +
// CBOR framing + 64-byte P1363 signature. 4096 is a safe fixed value; the cert
// dominates, so grow this if the cert chain ever lengthens.
const COSE_RESERVE_SIZE = 4096

// c2pa-web is heavy (8 MB wasm + a nested worker), so load it lazily and only
// once, on the first signing attempt.
let c2paPromise: Promise<import('@contentauth/c2pa-web').C2paSdk> | null = null

function getC2pa(): Promise<import('@contentauth/c2pa-web').C2paSdk> {
  if (!c2paPromise) {
    c2paPromise = (async () => {
      const { createC2pa } = await import('@contentauth/c2pa-web')
      const wasmSrc = (await import('@contentauth/c2pa-web/resources/c2pa.wasm?url')).default
      return createC2pa({ wasmSrc })
    })()
  }
  return c2paPromise
}

export interface C2paSignResult {
  /** The signed file bytes (JUMBF box embedded). */
  blob: Blob
}

/**
 * Sign an export blob via the remote claim-signing service + local embed.
 * Returns `null` on any failure so the export can proceed unsigned.
 */
export async function signExportBlob(opts: {
  blob: Blob
  mimeType: string
  composition: CompositionInputProps
  wallet?: string
  signal?: AbortSignal
}): Promise<C2paSignResult | null> {
  const { blob, mimeType, composition, wallet, signal } = opts

  try {
    const c2pa = await getC2pa()
    const builder = await c2pa.builder.new()

    try {
      // An export is an edit of pre-existing source media.
      await builder.setIntent('edit')

      await builder.addAssertion('c2pa.actions', { actions: [{ action: 'c2pa.edited' }] })

      // Author identity (DID:ethr) — must match the signing cert's subject.
      if (wallet) {
        await builder.addAssertion('stds.schema-org.CreativeWork', {
          author: [{ '@id': `did:ethr:${wallet}` }],
        })
      }

      // Ingredients: each source clip, hashed by c2pa-web from its blob.
      const sources = collectIngredientSources(composition)
      for (const { title, src } of sources) {
        if (signal?.aborted) return null
        try {
          const res = await fetch(src, { signal })
          if (!res.ok) continue
          const ingredientBlob = await res.blob()
          await builder.addIngredientFromBlob(
            { title, relationship: 'componentOf' },
            ingredientBlob.type || 'application/octet-stream',
            ingredientBlob,
          )
        } catch {
          // A single unhashable ingredient shouldn't block signing; skip it.
        }
      }

      const signer: Signer = {
        alg: 'es256',
        reserveSize: async () => COSE_RESERVE_SIZE,
        sign: async (data: Uint8Array) => {
          // Copy into a fresh ArrayBuffer-backed view so it satisfies BodyInit.
          const body = new Uint8Array(data)
          const res = await fetch(SIGN_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              ...(wallet ? { 'X-C2PA-Wallet': wallet } : {}),
            },
            body,
            signal,
          })
          if (!res.ok) throw new Error(`C2PA sign failed: ${res.status}`)
          return new Uint8Array(await res.arrayBuffer())
        },
      }

      const signedBytes = await builder.sign(signer, mimeType, blob)
      return { blob: new Blob([signedBytes], { type: mimeType }) }
    } finally {
      await builder.free()
    }
  } catch {
    // Non-fatal: signing is best-effort.
    return null
  }
}
