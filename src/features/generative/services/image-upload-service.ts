// fallow-ignore-file complexity,unused-export
import { createLogger } from '@/shared/logging/logger'
import { PIXELS_SIGNER_HEADER } from '@/features/generative/pixels-api-identity'

const log = createLogger('ImageUploadService')

/**
 * Convert a local Blob into a publicly fetchable HTTPS URL for Vertex generative APIs.
 * Uploads via `/api/flow-frame` (auth required); falls back is not used for Flow.
 */
export async function getPublicImageUrl(
  blob: Blob,
  auth?: {
    getAccessToken: () => Promise<string | null>
    signerAddress: `0x${string}`
  },
): Promise<string> {
  if (!auth) {
    throw new Error('Wallet auth required to upload Flow frames')
  }
  const token = await auth.getAccessToken()
  if (!token) {
    throw new Error('Not authenticated')
  }

  const form = new FormData()
  form.append('file', blob, blob.type.includes('png') ? 'frame.png' : 'frame.jpg')
  form.append('signerAddress', auth.signerAddress)

  const response = await fetch('/api/flow-frame', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      [PIXELS_SIGNER_HEADER]: auth.signerAddress,
    },
    body: form,
  })
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error || `Frame upload failed (${response.status})`)
  }
  const body = (await response.json()) as { url?: string }
  if (!body.url?.startsWith('http')) {
    throw new Error('Frame upload returned no URL')
  }
  log.debug('Uploaded flow frame', { url: body.url.slice(0, 64) })
  return body.url
}

/**
 * For generated images that already have HTTP URLs, return as-is.
 * For local file blobs, upload to a public URL.
 */
export async function ensurePublicUrl(
  source: { type: 'file'; blob: Blob } | { type: 'generated'; url: string },
  auth?: {
    getAccessToken: () => Promise<string | null>
    signerAddress: `0x${string}`
  },
): Promise<string> {
  if (source.type === 'generated') {
    if (source.url.startsWith('http://') || source.url.startsWith('https://')) {
      return source.url
    }
    if (source.url.startsWith('data:') && auth) {
      const token = await auth.getAccessToken()
      if (!token) throw new Error('Not authenticated')
      const response = await fetch('/api/flow-frame', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [PIXELS_SIGNER_HEADER]: auth.signerAddress,
        },
        body: JSON.stringify({
          dataUri: source.url,
          signerAddress: auth.signerAddress,
        }),
      })
      if (!response.ok) {
        throw new Error(`Frame upload failed (${response.status})`)
      }
      const body = (await response.json()) as { url?: string }
      if (!body.url) throw new Error('Frame upload returned no URL')
      return body.url
    }
    throw new Error('Generated image URL must be http(s) or data: with auth')
  }
  return getPublicImageUrl(source.blob, auth)
}
