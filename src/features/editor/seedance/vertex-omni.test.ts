import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SIGNER = '0xabc' as `0x${string}`

vi.mock('../../../../api/_vertex-auth.js', () => ({
  getVertexAccessToken: vi.fn(async () => 'test-vertex-token'),
  getVertexProject: vi.fn(() => 'creative-ai-491118'),
  isVertexAuthConfigured: vi.fn(() => false),
}))

vi.mock('../../../../api/_redis-client.js', () => ({
  getRedis: vi.fn(async () => null),
  isRedisConfigured: vi.fn(() => false),
}))

vi.mock('../../../../api/_pixels-generate-route-auth.js', () => ({
  authenticateGenerativeGet: vi.fn(async () => ({ ok: true, signer: SIGNER })),
}))

vi.mock('../../../../api/_pixels-generate-veo-sync.js', () => ({
  syncPixelsVeoJobFromPoll: vi.fn(async () => undefined),
}))

describe('Gemini Omni 1.2 Flash Vertex Interactions integration', () => {
  const originalVercel = process.env.VERCEL
  const originalProject = process.env.GOOGLE_CLOUD_PROJECT

  beforeEach(() => {
    delete process.env.VERCEL
    process.env.GOOGLE_CLOUD_PROJECT = 'creative-ai-491118'
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    const { __resetOmniMediaStoreForTest } = await import('../../../../api/_omni-media-store')
    __resetOmniMediaStoreForTest()
    if (originalVercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = originalVercel
    if (originalProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT
    else process.env.GOOGLE_CLOUD_PROJECT = originalProject
  })

  it('startOmniVideo sends user_input content, natural-language keyframes, and global endpoint', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ id: 'v1_interaction_123', status: 'in_progress' }), {
        status: 200,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { startOmniVideo } = await import('../../../../api/_vertex-omni')
    const started = await startOmniVideo({
      prompt: 'Smooth tracking push through neon rain',
      startImage: { bytes: Buffer.from('start-bytes'), mimeType: 'image/png' },
      endImage: { bytes: Buffer.from('end-bytes'), mimeType: 'image/jpeg' },
      duration: 12,
      quality: '4K',
      aspectRatio: '1:1',
    })

    expect(started).toEqual({
      interactionId: 'v1_interaction_123',
      modelId: 'gemini-omni-1.2-flash',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/creative-ai-491118/locations/global/interactions',
    )

    const payload = JSON.parse(String(init.body)) as {
      model: string
      background: boolean
      input: Array<{ type: string; content: Array<Record<string, unknown>> }>
      response_format: {
        type: string
        aspect_ratio: string
        resolution: string
        duration: string
      }
    }
    expect(payload.model).toBe('gemini-omni-1.2-flash')
    expect(payload.background).toBe(true)
    expect(payload.input[0]?.type).toBe('user_input')
    expect(payload.input[0]?.content).toHaveLength(3)
    const textPart = String(payload.input[0]?.content[2]?.text ?? '')
    expect(textPart).toContain(
      'Use the first image as the starting frame and the second image as the final frame.',
    )
    expect(textPart).not.toContain('<FIRST_FRAME>')
    expect(payload.response_format).toEqual({
      type: 'video',
      aspect_ratio: '16:9',
      resolution: '4k',
      duration: '10s',
    })
  })

  it('pollOmniInteraction maps in_progress, completed steps, and failed statuses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'v1_a', status: 'in_progress' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'v1_a',
            status: 'completed',
            steps: [
              {
                type: 'model_output',
                content: [
                  {
                    type: 'video',
                    mime_type: 'video/mp4',
                    data: Buffer.from('mp4-binary-payload').toString('base64'),
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'v1_a',
            status: 'failed',
            error: { message: 'Safety block' },
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const { pollOmniInteraction } = await import('../../../../api/_vertex-omni')

    expect(await pollOmniInteraction('v1_a')).toEqual({
      status: 'processing',
      progress: 35,
    })

    expect(await pollOmniInteraction('v1_a')).toEqual({
      status: 'completed',
      progress: 100,
      videoBase64: Buffer.from('mp4-binary-payload').toString('base64'),
      mimeType: 'video/mp4',
    })

    expect(await pollOmniInteraction('v1_a')).toEqual({
      status: 'failed',
      progress: 100,
      errorMessage: 'Safety block',
    })
  })

  it('generate-task caches Omni video as same-origin media URL and streams MP4 bytes cleanly', async () => {
    const vertexAuth = await import('../../../../api/_vertex-auth.js')
    vi.spyOn(vertexAuth, 'isVertexAuthConfigured').mockReturnValue(true)

    const mp4Bytes = Buffer.from('00000018ftypmp42-test-video-bytes')
    const vertexCalls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const targetUrl = String(input)
      if (targetUrl.includes('/locations/global/interactions/')) {
        vertexCalls.push(targetUrl)
        return new Response(
          JSON.stringify({
            id: 'v1_omni_done',
            status: 'completed',
            steps: [
              {
                type: 'model_output',
                content: [
                  {
                    type: 'video',
                    mime_type: 'video/mp4',
                    data: mp4Bytes.toString('base64'),
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        )
      }
      if (targetUrl.includes('/upload/storage/v1/b/')) {
        return new Response(JSON.stringify({ name: 'omni-media/test.mp4' }), { status: 200 })
      }
      if (targetUrl.includes('alt=media')) {
        return new Response(new Uint8Array(mp4Bytes), {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': String(mp4Bytes.byteLength),
          },
        })
      }
      throw new Error(`Unexpected fetch URL: ${targetUrl}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { registerGenerativeTask } = await import('../../../../api/_task-registry')
    await registerGenerativeTask('v1_omni_done', SIGNER, {
      operationName: 'v1_omni_done',
      interactionId: 'v1_omni_done',
      modelId: 'gemini-omni-1.2-flash',
      kind: 'omni',
    })

    const { GET } = await import('../../../../api/generate-task')
    const pollRes = await GET(
      new Request('http://localhost:5173/api/generate-task?id=v1_omni_done'),
    )
    expect(pollRes.status).toBe(200)
    const detail = (await pollRes.json()) as {
      status: string
      output?: { video_url?: string }
    }
    expect(detail.status).toBe('completed')
    const mediaUrl = detail.output?.video_url ?? ''
    expect(mediaUrl).toMatch(/^http:\/\/localhost:5173\/api\/generate-task\?media=[a-f0-9]{48}$/)

    // Second poll reuses cached mediaUrl without re-polling Vertex
    const secondPollRes = await GET(
      new Request('http://localhost:5173/api/generate-task?id=v1_omni_done'),
    )
    expect(secondPollRes.status).toBe(200)
    expect(vertexCalls).toHaveLength(1)

    // Serving the media URL streams the MP4 bytes with CORP headers
    const mediaRes = await GET(new Request(mediaUrl))
    expect(mediaRes.status).toBe(200)
    expect(mediaRes.headers.get('Content-Type')).toBe('video/mp4')
    expect(mediaRes.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin')
    expect(Buffer.from(await mediaRes.arrayBuffer()).equals(mp4Bytes)).toBe(true)

    // Invalid media token returns 400
    const badMediaRes = await GET(
      new Request('http://localhost:5173/api/generate-task?media=not-a-valid-token'),
    )
    expect(badMediaRes.status).toBe(400)
  })
})
