import { describe, expect, it } from 'vitest'
import { encodeAdkEventsAsSse } from '../../../../api/_director-adk.js'

describe('encodeAdkEventsAsSse', () => {
  it('formats ADK events as SSE data lines', () => {
    const bytes = encodeAdkEventsAsSse([{ content: { parts: [{ text: 'Hi' }] } }])
    const text = new TextDecoder().decode(bytes)
    expect(text).toBe('data: {"content":{"parts":[{"text":"Hi"}]}}\n\n')
  })
})
