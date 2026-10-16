import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HCAPTCHA_ORIGINS,
  HCAPTCHA_SCRIPT_EVAL_SOURCE,
  LEGACY_STAGING_CONTENT_SECURITY_POLICY_REPORT_ONLY,
  PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY,
  buildPreviewStagingEnforcedContentSecurityPolicy,
  parseContentSecurityPolicyDirectives,
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

function directiveSources(policy: string, directive: string): string[] {
  return parseContentSecurityPolicyDirectives(policy).get(directive) ?? []
}

function assertDirectiveSuperset(enforced: string, legacy: string): void {
  const enforcedDirectives = parseContentSecurityPolicyDirectives(enforced)
  for (const [directive, legacySources] of parseContentSecurityPolicyDirectives(legacy)) {
    const enforcedSources = new Set(enforcedDirectives.get(directive) ?? [])
    for (const source of legacySources) {
      expect(enforcedSources.has(source), `${directive} missing ${source}`).toBe(true)
    }
  }
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
      const enforced = headers.find((header) => header.key === 'Content-Security-Policy')?.value ?? ''
      for (const name of ['script-src', 'frame-src', 'connect-src', 'style-src'] as const) {
        for (const origin of HCAPTCHA_ORIGINS) {
          expect(directiveSources(enforced, name), name).toContain(origin)
        }
      }
      expect(directiveSources(enforced, 'script-src')).toContain(HCAPTCHA_SCRIPT_EVAL_SOURCE)
    }
  })

  it('keeps preview/staging enforcing CSP as a superset of legacy staging report-only', () => {
    const enforced = buildPreviewStagingEnforcedContentSecurityPolicy()
    assertDirectiveSuperset(enforced, LEGACY_STAGING_CONTENT_SECURITY_POLICY_REPORT_ONLY)

    for (const origin of ['https://auth.privy.io', 'https://*.privy.io']) {
      expect(directiveSources(enforced, 'connect-src')).toContain(origin)
      expect(directiveSources(enforced, 'frame-src')).toContain(origin)
    }
    for (const origin of [
      'wss://relay.walletconnect.com',
      'wss://relay.walletconnect.org',
      'wss://www.walletlink.org',
      'https://*.rpc.privy.systems',
    ]) {
      expect(directiveSources(enforced, 'connect-src')).toContain(origin)
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
  })
})
