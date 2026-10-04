import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adkEventsIncludeSessionId,
  encodeAdkEventsAsSse,
  getDirectorAdkBaseUrl,
  withAdkSessionEvent,
} from '../../../../api/_director-adk.js'

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
