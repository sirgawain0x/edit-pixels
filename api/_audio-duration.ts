/**
 * Probe public audio/video URL duration for Director billing cross-checks.
 */
// fallow-ignore-file complexity

import { parseBuffer } from 'music-metadata'

const MAX_PROBE_BYTES = 2 * 1024 * 1024
const FETCH_TIMEOUT_MS = 12_000

/**
 * Best-effort duration (seconds) from an https media URL.
 * Returns null when the URL cannot be fetched or parsed.
 */
export async function probeAudioDurationSeconds(audioUri: string): Promise<number | null> {
  const url = audioUri.trim()
  if (!/^https:\/\//i.test(url)) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: `bytes=0-${MAX_PROBE_BYTES - 1}` },
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!(response.ok || response.status === 206)) return null

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength < 16) return null

    const mimeType = response.headers.get('content-type') ?? undefined
    const meta = await parseBuffer(
      buffer,
      { mimeType, size: buffer.byteLength },
      { duration: true },
    )
    const duration = meta.format.duration
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      return null
    }
    return duration
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
