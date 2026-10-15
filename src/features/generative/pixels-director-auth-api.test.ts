import { describe, expect, it, beforeEach } from 'vitest'
import { isDirectorSecretAuthorized } from '../../../api/_director-auth.js'

describe('isDirectorSecretAuthorized', () => {
  beforeEach(() => {
    process.env.DIRECTOR_API_SECRET = 'super-secret-value'
  })

  it('accepts x-director-secret with timing-safe comparison', () => {
    const ok = isDirectorSecretAuthorized(
      new Request('http://localhost/api/director', {
        headers: { 'x-director-secret': 'super-secret-value' },
      }),
    )
    expect(ok).toBe(true)
  })

  it('rejects wrong secret without throwing', () => {
    const ok = isDirectorSecretAuthorized(
      new Request('http://localhost/api/director', {
        headers: { 'x-director-secret': 'wrong-secret-value' },
      }),
    )
    expect(ok).toBe(false)
  })
})
