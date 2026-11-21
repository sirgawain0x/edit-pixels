import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAddress } from 'viem'

const { getUserById, verifyAuthToken } = vi.hoisted(() => ({
  getUserById: vi.fn(),
  verifyAuthToken: vi.fn(),
}))

vi.mock('@privy-io/server-auth', () => ({
  PrivyClient: class MockPrivyClient {
    verifyAuthToken = verifyAuthToken
    getUserById = getUserById
  },
}))

const SIGNER = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')

function ttsRequest(body: unknown, token: string | null = 'privy-token'): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: 'http://localhost',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request('http://localhost/api/director-tts', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('POST /api/director-tts', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    verifyAuthToken.mockReset()
    getUserById.mockReset()
    verifyAuthToken.mockResolvedValue({ userId: 'user-1' })
    getUserById.mockResolvedValue({ linkedAccounts: [{ type: 'wallet', address: SIGNER }] })
    process.env.PRIVY_APP_ID = 'app'
    process.env.PRIVY_APP_SECRET = 'secret'
    process.env.PIXELS_RATE_LIMIT_MODE = 'off'
    process.env.GEMINI_API_KEY = 'test-key'
    delete process.env.DIRECTOR_TTS_VOICE
    delete process.env.VERCEL
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.GEMINI_API_KEY
  })

  it('returns 401 without a bearer token', async () => {
    const { POST } = await import('../../../../api/director-tts.js')
    const response = await POST(ttsRequest({ text: 'Hello' }, null))
    expect(response.status).toBe(401)
  })

  it('returns 503 when GEMINI_API_KEY is not configured', async () => {
    delete process.env.GEMINI_API_KEY
    const { POST } = await import('../../../../api/director-tts.js')
    const response = await POST(ttsRequest({ text: 'Hello' }))
    expect(response.status).toBe(503)
  })

  it('rejects oversized chunks', async () => {
    const { POST } = await import('../../../../api/director-tts.js')
    const response = await POST(ttsRequest({ text: 'a'.repeat(2_001) }))
    expect(response.status).toBe(413)
  })

  it('synthesizes with the Kore voice by default and returns WAV bytes', async () => {
    const wav = Buffer.from('RIFF....WAVE')
    const upstream = vi.fn().mockResolvedValue(
      Response.json({
        steps: [
          { type: 'user_input', content: [{ type: 'text', text: 'Hello' }] },
          {
            type: 'model_output',
            content: [{ type: 'audio', data: wav.toString('base64'), mime_type: 'audio/wav' }],
          },
        ],
      }),
    )
    globalThis.fetch = upstream as unknown as typeof fetch

    const { POST } = await import('../../../../api/director-tts.js')
    const response = await POST(ttsRequest({ text: 'Hello there' }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/wav')
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('RIFF....WAVE')

    const [url, init] = upstream.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/v1beta/interactions')
    const sent = JSON.parse(String(init.body))
    expect(sent.generation_config.speech_config).toEqual([{ voice: 'Kore' }])
    expect(sent.input[0].content[0].text).toBe('Hello there')
    expect(JSON.stringify(sent)).not.toContain('Puck')
  })
})
