import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface HeaderEntry {
  key: string
  value: string
}

interface HeaderRoute {
  source: string
  headers: HeaderEntry[]
}

function siteHeaders(): HeaderEntry[] {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
    headers: HeaderRoute[]
  }
  const site = vercel.headers.find((entry) => entry.source === '/(.*)')
  if (!site) throw new Error('site header route missing')
  return site.headers
}

describe('content security policy', () => {
  it('reports Privy, font, worker, and Coinbase origins without enforcing', () => {
    const headers = siteHeaders()
    expect(headers.some((header) => header.key === 'Content-Security-Policy')).toBe(false)

    const policy = headers.find((header) => header.key === 'Content-Security-Policy-Report-Only')
    expect(policy?.value).toEqual(expect.any(String))
    const value = policy?.value ?? ''

    for (const required of [
      "default-src 'self'",
      'https://auth.privy.io',
      'https://privy.create.creativeplatform.xyz',
      'https://explorer-api.walletconnect.com',
      'https://verify.walletconnect.com',
      'https://verify.walletconnect.org',
      'https://challenges.cloudflare.com',
      'wss://relay.walletconnect.com',
      'wss://relay.walletconnect.org',
      'wss://www.walletlink.org',
      'https://*.rpc.privy.systems',
      'https://explorer-api.walletconnect.com',
      'https://accounts.google.com',
      'https://farcaster.xyz',
      'https://warpcast.com',
      'https://fonts.googleapis.com',
      'https://fonts.gstatic.com',
      'https://pay.coinbase.com',
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
    ]) {
      expect(value, required).toContain(required)
    }
  })
})
