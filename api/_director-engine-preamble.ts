/**
 * Read the first Agent Engine chunk before the handler returns a stream.
 * An empty or thrown read stays a normal result so the caller can release
 * payment and return JSON instead of failing the Vercel invocation.
 */

export type EnginePreamble =
  | {
      ok: true
      chunk: Uint8Array
      reader: ReadableStreamDefaultReader<Uint8Array>
    }
  | { ok: false }

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  await reader.cancel().catch(() => undefined)
}

export async function readFirstEngineChunk(body: ReadableStream<Uint8Array>): Promise<EnginePreamble> {
  const reader = body.getReader()
  try {
    const { done, value } = await reader.read()
    if (done || !value || value.byteLength === 0) {
      await cancelReader(reader)
      return { ok: false }
    }
    return { ok: true, chunk: value, reader }
  } catch (error) {
    console.error('Director engine preamble read failed', error)
    await cancelReader(reader)
    return { ok: false }
  }
}
