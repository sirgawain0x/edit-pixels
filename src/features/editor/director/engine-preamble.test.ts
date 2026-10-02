import { describe, expect, it } from 'vitest'
import { readFirstEngineChunk } from '../../../../api/_director-engine-preamble'

function streamFrom(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      const chunk = chunks[index]
      index += 1
      if (chunk) controller.enqueue(chunk)
    },
  })
}

describe('readFirstEngineChunk', () => {
  it('keeps a non-empty first chunk and the reader for the rest of the stream', async () => {
    const first = new TextEncoder().encode('data: hello\n\n')
    const second = new TextEncoder().encode('data: world\n\n')
    const preamble = await readFirstEngineChunk(streamFrom([first, second]))

    expect(preamble.ok).toBe(true)
    if (!preamble.ok) return
    expect(new TextDecoder().decode(preamble.chunk)).toBe('data: hello\n\n')

    const next = await preamble.reader.read()
    expect(next.done).toBe(false)
    expect(new TextDecoder().decode(next.value)).toBe('data: world\n\n')
    await preamble.reader.cancel()
  })

  it('fails closed when the engine stream ends before any bytes', async () => {
    const preamble = await readFirstEngineChunk(streamFrom([]))
    expect(preamble).toEqual({ ok: false })
  })

  it('fails closed when the first read throws', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('engine reset')
      },
    })
    const preamble = await readFirstEngineChunk(body)
    expect(preamble).toEqual({ ok: false })
  })
})
