import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./_vertex-auth.js', () => ({
  getVertexAccessToken: async () => 'test-token',
}))

const BUCKET = 'creative-pixels-transcribe-batch'
const ACCOUNT = '0x04f5c5691e2f3e79246b08b98e912b3d2a786696'
const OBJECT = `input/${ACCOUNT}/job-1/part-0.webm`

async function gcs() {
  return import('./_transcribe-gcs.js')
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('createUploadSession', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('asks GCS for a resumable session for the given object', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { location: `https://storage.googleapis.com/upload/session/abc` },
        }),
    ) as unknown as typeof fetch

    const { createUploadSession } = await gcs()
    const result = await createUploadSession({
      objectName: OBJECT,
      contentType: 'audio/webm',
      metadata: { jobId: 'job-1' },
    })

    expect(result.sessionUri).toBe('https://storage.googleapis.com/upload/session/abc')
    const call = vi.mocked(globalThis.fetch).mock.calls[0]
    // The object name is URL-encoded, so the slashes cannot be reinterpreted as a path.
    // `ifGenerationMatch=0` makes the write create-only: a second session for a part
    // that already landed gets 412 at finalize instead of replacing the audio.
    expect(call?.[0]).toBe(
      `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o` +
        `?uploadType=resumable&name=${encodeURIComponent(OBJECT)}` +
        `&ifGenerationMatch=0`,
    )
    const init = call?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
    // No Origin given, so none is sent: the header decides whether a browser can read
    // the upload response, and inventing one would bind the session to the wrong site.
    expect((init.headers as Record<string, string>).Origin).toBeUndefined()
    expect(JSON.parse(String(init.body))).toEqual({
      contentType: 'audio/webm',
      metadata: { jobId: 'job-1' },
    })
  })

  it('fails when GCS returns no session location', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch
    const { createUploadSession } = await gcs()

    await expect(
      createUploadSession({ objectName: OBJECT, contentType: 'audio/webm' }),
    ).rejects.toThrow('no Location')
  })

  it('refuses a session URI on a host we did not ask for', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(null, { status: 200, headers: { location: 'https://evil.test/upload' } }),
    ) as unknown as typeof fetch
    const { createUploadSession } = await gcs()

    await expect(
      createUploadSession({ objectName: OBJECT, contentType: 'audio/webm' }),
    ).rejects.toThrow('unexpected host')
  })

  it('surfaces a GCS error with its status', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('nope', { status: 403 }),
    ) as unknown as typeof fetch
    const { createUploadSession } = await gcs()

    await expect(
      createUploadSession({ objectName: OBJECT, contentType: 'audio/webm' }),
    ).rejects.toThrow('403')
  })

  it('forwards the browser Origin so GCS can answer CORS for the PUT', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { location: 'https://storage.googleapis.com/upload/session/abc' },
        }),
    ) as unknown as typeof fetch
    const { createUploadSession } = await gcs()

    await createUploadSession({
      objectName: OBJECT,
      contentType: 'audio/webm',
      origin: 'https://pixels.example',
    })

    const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).Origin).toBe('https://pixels.example')
  })
})

describe('statParts', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ size: '4096', contentType: 'audio/webm' }),
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('reports size and existence for every part', async () => {
    const { statParts } = await gcs()
    const stats = await statParts([`gs://${BUCKET}/${OBJECT}`])

    expect(stats).toEqual([{ uri: `gs://${BUCKET}/${OBJECT}`, exists: true, sizeBytes: 4096 }])
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toBe(
      `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(OBJECT)}?fields=size,contentType`,
    )
  })

  it('treats a missing object as not uploaded', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('not found', { status: 404 }),
    ) as unknown as typeof fetch
    const { statParts } = await gcs()

    expect(await statParts([`gs://${BUCKET}/${OBJECT}`])).toEqual([
      { uri: `gs://${BUCKET}/${OBJECT}`, exists: false, sizeBytes: 0 },
    ])
  })

  it('treats a zero-byte object as not uploaded, because Google would bill it', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ size: '0' })) as unknown as typeof fetch
    const { statParts } = await gcs()

    const [stat] = await statParts([`gs://${BUCKET}/${OBJECT}`])
    expect(stat?.exists).toBe(false)
  })

  it('throws on an unexpected GCS failure so the caller can refuse', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch
    const { statParts } = await gcs()

    await expect(statParts([`gs://${BUCKET}/${OBJECT}`])).rejects.toThrow('500')
  })

  it('rejects a uri that is not gs://', async () => {
    const { statParts } = await gcs()
    await expect(statParts(['https://storage.googleapis.com/x'])).rejects.toThrow('not a gs:// uri')
  })
})
