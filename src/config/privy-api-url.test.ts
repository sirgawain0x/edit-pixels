import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PRIVY_DEFAULT_AUTH_API_URL,
  PRIVY_PRODUCTION_CUSTOM_API_URL,
  resolvePrivyApiUrl,
} from './privy-api-url'

describe('resolvePrivyApiUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the custom domain in production', () => {
    vi.stubEnv('VITE_VERCEL_ENV', 'production')
    expect(resolvePrivyApiUrl()).toBe(PRIVY_PRODUCTION_CUSTOM_API_URL)
  })

  it('returns undefined for preview', () => {
    vi.stubEnv('VITE_VERCEL_ENV', 'preview')
    expect(resolvePrivyApiUrl()).toBeUndefined()
  })

  it('returns undefined for development', () => {
    vi.stubEnv('VITE_VERCEL_ENV', 'development')
    expect(resolvePrivyApiUrl()).toBeUndefined()
  })

  it('returns undefined when VITE_VERCEL_ENV is missing', () => {
    vi.stubEnv('VITE_VERCEL_ENV', '')
    expect(resolvePrivyApiUrl()).toBeUndefined()
  })

  it('documents the default auth host constant', () => {
    expect(PRIVY_DEFAULT_AUTH_API_URL).toBe('https://auth.privy.io')
  })
})
