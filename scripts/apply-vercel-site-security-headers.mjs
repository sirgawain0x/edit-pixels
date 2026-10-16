import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY,
  resolveContentSecurityPolicyHeaders,
  shouldUsePreviewStagingReportOnlyContentSecurityPolicy,
} from '../src/config/content-security-policy.ts'

const SITE_ROUTE_SOURCE = '/(.*)'

const STATIC_SITE_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
]

function loadSiteRoute(vercel) {
  const siteRoute = vercel.headers?.find((entry) => entry.source === SITE_ROUTE_SOURCE)
  if (!siteRoute) throw new Error(`Missing headers route ${SITE_ROUTE_SOURCE}`)
  return siteRoute
}

function assertNoEnforcingContentSecurityPolicy(cspHeaders) {
  if (cspHeaders.some((header) => header.key === 'Content-Security-Policy')) {
    throw new Error('Enforcing Content-Security-Policy must not be set')
  }
}

function assertProductionReportOnlyWhenRequired(cspHeaders, input) {
  if (shouldUsePreviewStagingReportOnlyContentSecurityPolicy(input)) return
  const reportOnly = cspHeaders.find((header) => header.key === 'Content-Security-Policy-Report-Only')
  if (reportOnly?.value !== PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY) {
    throw new Error('Production report-only CSP drifted during Vercel header patch')
  }
}

function patchVercelSiteSecurityHeaders() {
  if (!process.env.VERCEL) return

  const input = {
    vercelEnv: process.env.VERCEL_ENV,
    gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF,
  }

  const vercelPath = join(process.cwd(), 'vercel.json')
  const vercel = JSON.parse(readFileSync(vercelPath, 'utf8'))
  const siteRoute = loadSiteRoute(vercel)
  const cspHeaders = resolveContentSecurityPolicyHeaders(input)

  assertNoEnforcingContentSecurityPolicy(cspHeaders)
  assertProductionReportOnlyWhenRequired(cspHeaders, input)

  siteRoute.headers = [...STATIC_SITE_HEADERS, ...cspHeaders]
  writeFileSync(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`)
}

patchVercelSiteSecurityHeaders()
