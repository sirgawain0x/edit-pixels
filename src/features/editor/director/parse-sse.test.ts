import { describe, expect, it } from 'vitest'
import { consumeSseBuffer, mapAdkEvent, parseSseDataLine } from './parse-sse'

describe('consumeSseBuffer', () => {
  it('splits complete SSE frames and keeps a partial rest', () => {
    const { events, rest } = consumeSseBuffer(
      'data: {"content":{"parts":[{"text":"Hi"}]}}\n\ndata: {"partial',
    )
    expect(events).toEqual(['{"content":{"parts":[{"text":"Hi"}]}}'])
    expect(rest).toBe('data: {"partial')
  })

  it('joins multi-line data payloads', () => {
    const { events, rest } = consumeSseBuffer('data: {"a":1}\ndata: {"b":2}\n\n')
    expect(events).toEqual(['{"a":1}\n{"b":2}'])
    expect(rest).toBe('')
  })
})

describe('mapAdkEvent', () => {
  it('maps text parts', () => {
    expect(
      mapAdkEvent({
        content: { parts: [{ text: 'Storyboard beat 1' }] },
      }),
    ).toEqual([{ type: 'text', text: 'Storyboard beat 1' }])
  })

  it('maps functionCall and functionResponse', () => {
    expect(
      mapAdkEvent({
        content: {
          parts: [
            { functionCall: { name: 'search_specialist', args: { q: 'lyrics' } } },
            { functionResponse: { name: 'search_specialist', response: { ok: true } } },
          ],
        },
      }),
    ).toEqual([
      { type: 'tool', name: 'search_specialist', args: { q: 'lyrics' } },
      { type: 'tool-result', name: 'search_specialist', result: { ok: true } },
    ])
  })

  it('maps errors and session ids', () => {
    expect(
      mapAdkEvent({
        session_id: 'sess-1',
        errorMessage: 'quota exceeded',
      }),
    ).toEqual([
      { type: 'session', sessionId: 'sess-1' },
      { type: 'error', message: 'quota exceeded' },
    ])
  })

  it('parses JSON strings and ignores [DONE]', () => {
    expect(parseSseDataLine('[DONE]')).toEqual([])
    expect(parseSseDataLine('{"content":{"parts":[{"text":"x"}]}}')).toEqual([
      { type: 'text', text: 'x' },
    ])
  })

  it('treats non-JSON strings as text', () => {
    expect(mapAdkEvent('plain note')).toEqual([{ type: 'text', text: 'plain note' }])
  })
})
