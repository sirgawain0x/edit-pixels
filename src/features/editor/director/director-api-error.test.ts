import { describe, expect, it } from 'vitest'
import { directorFailureMessage } from './director-api-error'

describe('directorFailureMessage', () => {
  it('uses a string error field', () => {
    expect(directorFailureMessage(402, { error: 'Director payment rejected: too low' })).toBe(
      'Director payment rejected: too low',
    )
  })

  it('reads Vercel invocation errors without returning the object', () => {
    const message = directorFailureMessage(500, {
      error: { code: 'FUNCTION_INVOCATION_FAILED', message: 'A server error has occurred' },
    })
    expect(message).toContain('Director crashed before streaming')
    expect(typeof message).toBe('string')
  })

  it('falls back to the status when the body is empty', () => {
    expect(directorFailureMessage(500, null)).toBe('Director request failed (500)')
  })
})
