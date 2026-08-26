// fallow-ignore-file unused-file,complexity
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('ImageUploadService')

/**
 * Convert a local Blob into a publicly fetchable HTTPS URL for Evolink.
 * Uploads via `/api/flow-frame` (auth required); falls back is not used for Flow.
 */
export async function getPublicImageUrl(
  blob: Blob,
  auth?: {
    getAccessToken: () => Promise<string | null>
    walletAddress: `0x${string}`
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
  form.append('walletAddress', auth.walletAddress)

  const response = await fetch('/api/flow-frame', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
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
    walletAddress: `0x${string}`
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
        },
        body: JSON.stringify({
          dataUri: source.url,
          walletAddress: auth.walletAddress,
        }),
      })
      if (!response.ok) {
        throw new Error(`Frame upload failed (${response.status})`)
      }
      const body = (await response.json()) as { url?: string }
      if (!body.url) throw new Error('Frame upload returned no URL')
      return body.url
    }
    return source.url
  }
  return getPublicImageUrl(source.blob, auth)
}
