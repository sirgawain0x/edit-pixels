/**
 * Probe public audio/video URL duration for Director billing cross-checks.
 */
// fallow-ignore-file complexity

const MAX_PROBE_BYTES = 2 * 1024 * 1024
const FETCH_TIMEOUT_MS = 12_000

type ParseBuffer = typeof import('music-metadata').parseBuffer

/**
 * Dynamic import so a music-metadata load failure becomes a null duration
 * instead of crashing the Vercel isolate while the Director module loads.
 */
async function loadParseBuffer(): Promise<ParseBuffer | null> {
  try {
    const musicMetadata = await import('music-metadata')
    return musicMetadata.parseBuffer
  } catch (error) {
    console.error('music-metadata load failed', error)
    return null
  }
}

/**
 * Read at most `maxBytes` from a response body.
 * Hosts that ignore Range and answer 200 still cannot fill the function heap.
 */
export async function readCappedBytes(response: Response, maxBytes: number): Promise<Buffer | null> {
  if (maxBytes <= 0) return null
  const reader = response.body?.getReader()
  if (!reader) return null

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      const remaining = maxBytes - total
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining))
        total += remaining
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  if (total < 16) return null
  return Buffer.concat(chunks, total)
}

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

    const buffer = await readCappedBytes(response, MAX_PROBE_BYTES)
    if (!buffer) return null

    const parseBuffer = await loadParseBuffer()
    if (!parseBuffer) return null

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
