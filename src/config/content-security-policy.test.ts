import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HCAPTCHA_ORIGINS,
  HCAPTCHA_SCRIPT_EVAL_SOURCE,
  STAGING_PREVIEW_EXTRA_PRIVY_ORIGINS,
  LEGACY_STAGING_CONTENT_SECURITY_POLICY_REPORT_ONLY,
  PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY,
  buildPreviewStagingReportOnlyContentSecurityPolicy,
  parseContentSecurityPolicyDirectives,
  resolveContentSecurityPolicyHeaders,
  resolveReportOnlyContentSecurityPolicyForDeployment,
  shouldUsePreviewStagingReportOnlyContentSecurityPolicy,
} from '../../content-security-policy.ts'

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

function assertDirectiveSuperset(next: string, legacy: string): void {
  const nextDirectives = parseContentSecurityPolicyDirectives(next)
  for (const [directive, legacySources] of parseContentSecurityPolicyDirectives(legacy)) {
    const nextSources = new Set(nextDirectives.get(directive) ?? [])
    for (const source of legacySources) {
      expect(nextSources.has(source), `${directive} missing ${source}`).toBe(true)
    }
  }
}

describe('content security policy', () => {
  it('keeps CSP out of committed vercel.json so middleware owns report-only headers', () => {
    const headers = siteHeaders()
    expect(headers.some((header) => header.key === 'Content-Security-Policy-Report-Only')).toBe(false)
    expect(headers.some((header) => header.key === 'Content-Security-Policy')).toBe(false)
    expect(headers.map((header) => header.key).sort()).toEqual([
      'X-Content-Type-Options',
      'X-Frame-Options',
      'X-XSS-Protection',
    ])
  })

  it('resolves report-only CSP from VERCEL_ENV and git ref (middleware contract)', () => {
    expect(
      resolveReportOnlyContentSecurityPolicyForDeployment({ vercelEnv: 'production', gitCommitRef: 'prod' }),
    ).toBe(PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY)

    const previewPolicy = resolveReportOnlyContentSecurityPolicyForDeployment({
      vercelEnv: 'preview',
      gitCommitRef: 'agent/privy-hcaptcha-csp-preview-33fa',
    })
    expect(previewPolicy).toBe(buildPreviewStagingReportOnlyContentSecurityPolicy())
    expect(directiveSources(previewPolicy, 'connect-src')).toContain('https://*.privy.io')

    const stagingBranchPolicy = resolveReportOnlyContentSecurityPolicyForDeployment({
      vercelEnv: 'production',
      gitCommitRef: 'staging',
    })
    expect(stagingBranchPolicy).toBe(buildPreviewStagingReportOnlyContentSecurityPolicy())
  })

  it('uses report-only (never enforcing) for preview and staging deploys', () => {
    expect(shouldUsePreviewStagingReportOnlyContentSecurityPolicy({ vercelEnv: 'production', gitCommitRef: 'prod' })).toBe(
      false,
    )

    const production = resolveContentSecurityPolicyHeaders({ vercelEnv: 'production', gitCommitRef: 'prod' })
    expect(production).toHaveLength(1)
    expect(production.some((header) => header.key === 'Content-Security-Policy')).toBe(false)
    expect(production[0]?.key).toBe('Content-Security-Policy-Report-Only')
    expect(production[0]?.value).toBe(PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY)

    for (const input of [
      { vercelEnv: 'preview', gitCommitRef: 'agent/privy-hcaptcha-csp-preview-33fa' },
      { vercelEnv: 'production', gitCommitRef: 'staging' },
    ]) {
      expect(shouldUsePreviewStagingReportOnlyContentSecurityPolicy(input)).toBe(true)
      const headers = resolveContentSecurityPolicyHeaders(input)
      expect(headers.some((header) => header.key === 'Content-Security-Policy')).toBe(false)
      const reportOnly = headers.find((header) => header.key === 'Content-Security-Policy-Report-Only')?.value ?? ''
      for (const name of ['script-src', 'frame-src', 'connect-src', 'style-src'] as const) {
        for (const origin of HCAPTCHA_ORIGINS) {
          expect(directiveSources(reportOnly, name), name).toContain(origin)
        }
      }
      expect(directiveSources(reportOnly, 'script-src')).toContain(HCAPTCHA_SCRIPT_EVAL_SOURCE)
    }
  })

  it('keeps preview/staging report-only as a superset of legacy staging report-only', () => {
    const reportOnly = buildPreviewStagingReportOnlyContentSecurityPolicy()
    assertDirectiveSuperset(reportOnly, LEGACY_STAGING_CONTENT_SECURITY_POLICY_REPORT_ONLY)

    for (const origin of ['https://auth.privy.io', ...STAGING_PREVIEW_EXTRA_PRIVY_ORIGINS]) {
      expect(directiveSources(reportOnly, 'connect-src')).toContain(origin)
      expect(directiveSources(reportOnly, 'frame-src')).toContain(origin)
    }
    for (const origin of [
      'wss://relay.walletconnect.com',
      'wss://relay.walletconnect.org',
      'wss://www.walletlink.org',
      'https://*.rpc.privy.systems',
    ]) {
      expect(directiveSources(reportOnly, 'connect-src')).toContain(origin)
    }
  })

  it('reports Privy, font, worker, and Coinbase origins in production report-only config', () => {
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
