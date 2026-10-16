import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HCAPTCHA_ORIGINS,
  HCAPTCHA_SCRIPT_EVAL_SOURCE,
  PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY,
  buildHcaptchaEnforcedContentSecurityPolicy,
  resolveContentSecurityPolicyHeaders,
  shouldApplyHcaptchaEnforcedContentSecurityPolicy,
} from './content-security-policy'

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

function directiveMap(policy: string): Record<string, string> {
  return Object.fromEntries(
    policy
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...rest] = part.split(/\s+/)
        return [name, rest.join(' ')]
      }),
  )
}

describe('content security policy', () => {
  it('keeps the committed production report-only policy byte-identical', () => {
    const headers = siteHeaders()
    const policy = headers.find((header) => header.key === 'Content-Security-Policy-Report-Only')
    expect(policy?.value).toBe(PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY)
    expect(headers.some((header) => header.key === 'Content-Security-Policy')).toBe(false)
  })

  it('adds enforced hCaptcha allowances only for preview and staging deploys', () => {
    expect(shouldApplyHcaptchaEnforcedContentSecurityPolicy({ vercelEnv: 'production', gitCommitRef: 'prod' })).toBe(
      false,
    )

    const production = resolveContentSecurityPolicyHeaders({ vercelEnv: 'production', gitCommitRef: 'prod' })
    expect(production.some((header) => header.key === 'Content-Security-Policy')).toBe(false)
    expect(production.find((header) => header.key === 'Content-Security-Policy-Report-Only')?.value).toBe(
      PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY,
    )

    for (const input of [
      { vercelEnv: 'preview', gitCommitRef: 'agent/privy-hcaptcha-csp-preview-33fa' },
      { vercelEnv: 'production', gitCommitRef: 'staging' },
    ]) {
      expect(shouldApplyHcaptchaEnforcedContentSecurityPolicy(input)).toBe(true)
      const headers = resolveContentSecurityPolicyHeaders(input)
      const enforced = headers.find((header) => header.key === 'Content-Security-Policy')
      expect(enforced?.value, JSON.stringify(input)).toEqual(expect.any(String))
      const directives = directiveMap(enforced?.value ?? '')
      for (const name of ['script-src', 'frame-src', 'connect-src']) {
        for (const origin of HCAPTCHA_ORIGINS) {
          expect(directives[name], name).toContain(origin)
        }
      }
      expect(directives['script-src']).toContain(HCAPTCHA_SCRIPT_EVAL_SOURCE)
    }
  })

  it('reports Privy, font, worker, and Coinbase origins without enforcing in production config', () => {
    const value = PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY

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
      'https://accounts.google.com',
      'https://farcaster.xyz',
      'https://warpcast.com',
      'https://fonts.googleapis.com',
      'https://fonts.gstatic.com',
      'https://pay.coinbase.com',
      'https://hcaptcha.com',
      'https://*.hcaptcha.com',
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
    ]) {
      expect(value, required).toContain(required)
    }

    expect(buildHcaptchaEnforcedContentSecurityPolicy()).toContain(
      PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY.slice(0, 32),
    )
  })
})
