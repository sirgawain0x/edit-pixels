/**
 * Server-side C2PA embed via c2pa-web + remote claim signing (C2PA_SIGN_URL).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const COSE_RESERVE_SIZE = 4096

const WASM_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../node_modules/@contentauth/c2pa-web/resources/c2pa.wasm',
)

let c2paPromise = null

async function getC2pa() {
  if (!c2paPromise) {
    c2paPromise = (async () => {
      const { createC2pa } = await import('@contentauth/c2pa-web')
      return createC2pa({ wasmSrc: WASM_PATH })
    })()
  }
  return c2paPromise
}

function walletFromDid(creatorDid) {
  const trimmed = creatorDid.trim()
  const match = /^did:ethr:(0x[a-fA-F0-9]{40})$/.exec(trimmed)
  if (match) return match[1]
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return trimmed
  return undefined
}

async function fetchBuffer(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`)
  }
  return Buffer.from(await response.arrayBuffer())
}

/**
 * Embed C2PA manifest into a video buffer.
 * @param {{
 *   masterUrl: string,
 *   creatorDid: string,
 *   ingredientUrls?: Array<{ title: string, url: string }>,
 *   certId?: string,
 *   signUrl?: string,
 * }} input
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
// fallow-ignore-next-line complexity
export async function embedC2paManifest(input) {
  const signUrl = input.signUrl?.trim() || process.env.C2PA_SIGN_URL?.trim()
  if (!signUrl) {
    throw new Error('C2PA_SIGN_URL is not configured on headless')
  }

  const masterBuffer = await fetchBuffer(input.masterUrl)
  const mimeType = 'video/mp4'
  const wallet = walletFromDid(input.creatorDid)
  const c2pa = await getC2pa()
  const builder = await c2pa.builder.new()

  try {
    await builder.setIntent('edit')
    await builder.addAssertion('c2pa.actions', {
      actions: [{ action: 'c2pa.edited' }, { action: 'c2pa.created' }],
    })

    if (wallet) {
      await builder.addAssertion('stds.schema-org.CreativeWork', {
        author: [{ '@id': `did:ethr:${wallet}` }],
      })
    }

    for (const ingredient of input.ingredientUrls ?? []) {
      try {
        const blob = await fetchBuffer(ingredient.url)
        await builder.addIngredientFromBuffer(
          { title: ingredient.title, relationship: 'componentOf' },
          'video/mp4',
          blob,
        )
      } catch {
        // skip unhashable ingredients
      }
    }

    const signer = {
      alg: 'es256',
      reserveSize: async () => COSE_RESERVE_SIZE,
      sign: async (data) => {
        const response = await fetch(signUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            ...(input.certId ? { 'X-C2PA-CertId': input.certId } : {}),
          },
          body: new Uint8Array(data),
        })
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          throw new Error(`C2PA sign failed (${response.status}): ${text}`)
        }
        return new Uint8Array(await response.arrayBuffer())
      },
    }

    const signed = await builder.sign(signer, mimeType, masterBuffer)
    return { buffer: Buffer.from(signed), mimeType }
  } finally {
    await builder.free()
  }
}
