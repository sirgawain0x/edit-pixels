import { describe, expect, it } from 'vitest'
import {
  adkEventsIncludeSessionId,
  encodeAdkEventsAsSse,
  withAdkSessionEvent,
} from '../../../../api/_director-adk.js'

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
