import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adkEventsIncludeSessionId,
  encodeAdkEventsAsSse,
  getDirectorAdkBaseUrl,
  runAdkDirector,
  withAdkSessionEvent,
} from '../../../../api/_director-adk.js'

vi.mock('../../../../api/_vertex-auth.js', () => ({
  getCloudRunIdToken: vi.fn(async () => 'mock-id-token'),
}))

describe('DIRECTOR_ADK_BASE_URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is unset when the Cloud Run env var is blank', () => {
    vi.stubEnv('DIRECTOR_ADK_BASE_URL', '')
    expect(getDirectorAdkBaseUrl()).toBeNull()
  })

  it('strips a trailing slash from the Cloud Run URL', () => {
    vi.stubEnv(
      'DIRECTOR_ADK_BASE_URL',
      'https://creative-director-1037240986506.us-east1.run.app/',
    )
    expect(getDirectorAdkBaseUrl()).toBe(
      'https://creative-director-1037240986506.us-east1.run.app',
    )
  })
})

describe('encodeAdkEventsAsSse', () => {
  it('detects session id on ADK events', () => {
    expect(adkEventsIncludeSessionId([{ sessionId: 'abc' }])).toBe(true)
    expect(adkEventsIncludeSessionId([{ content: { parts: [{ text: 'Hi' }] } }])).toBe(false)
  })

  it('prepends session event when missing', () => {
    const events = withAdkSessionEvent([{ content: { parts: [{ text: 'Hi' }] } }], 's1')
    expect(events[0]).toEqual({ sessionId: 's1', session_id: 's1' })
  })

  it('formats ADK events as SSE data lines', () => {
    const bytes = encodeAdkEventsAsSse([{ content: { parts: [{ text: 'Hi' }] } }])
    const text = new TextDecoder().decode(bytes)
    expect(text).toBe('data: {"content":{"parts":[{"text":"Hi"}]}}\n\n')
  })
})

describe('runAdkDirector Cloud Run auth', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends Authorization on session create and /run', async () => {
    const baseUrl = 'https://creative-director-1037240986506.us-east1.run.app'
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init })
        if (String(url).endsWith('/run')) {
          return new Response(JSON.stringify([{ content: { parts: [{ text: 'ok' }] } }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response('', { status: 200 })
      }),
    )

    await runAdkDirector({
      baseUrl,
      appName: 'agent',
      userId: 'creator-user',
      sessionId: 'sess-1',
      message: 'hello',
    })

    expect(calls).toHaveLength(2)
    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string> | undefined
      expect(headers?.Authorization).toBe('Bearer mock-id-token')
    }
  })
})
