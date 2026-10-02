import { describe, expect, it } from 'vitest'
import { readCappedBytes } from '../../../../api/_audio-duration'

function streamBytes(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength)
      controller.enqueue(bytes.subarray(offset, end))
      offset = end
    },
  })
}

describe('readCappedBytes', () => {
  it('stops at 2MB when a 200 response ignores Range and sends the whole file', async () => {
    const payload = new Uint8Array(3 * 1024 * 1024)
    payload.fill(7)
    const response = new Response(streamBytes(payload, 64 * 1024), {
      status: 200,
      headers: { 'Content-Length': String(payload.byteLength) },
    })

    const buffer = await readCappedBytes(response, 2 * 1024 * 1024)
    expect(buffer?.byteLength).toBe(2 * 1024 * 1024)
    expect(buffer?.[0]).toBe(7)
    expect(buffer?.[buffer.byteLength - 1]).toBe(7)
  })

  it('returns null when the body is shorter than a media header', async () => {
    const response = new Response(streamBytes(new Uint8Array(8), 8), { status: 200 })
    await expect(readCappedBytes(response, 2 * 1024 * 1024)).resolves.toBeNull()
  })
})
