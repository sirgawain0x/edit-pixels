import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY,
  resolveContentSecurityPolicyHeaders,
} from '../src/config/content-security-policy.ts'

const SITE_ROUTE_SOURCE = '/(.*)'

const STATIC_SITE_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
]

function patchVercelSiteSecurityHeaders() {
  if (!process.env.VERCEL) return

  const vercelPath = join(process.cwd(), 'vercel.json')
  const vercel = JSON.parse(readFileSync(vercelPath, 'utf8'))
  const siteRoute = vercel.headers?.find((entry) => entry.source === SITE_ROUTE_SOURCE)
  if (!siteRoute) throw new Error(`Missing headers route ${SITE_ROUTE_SOURCE}`)

  const cspHeaders = resolveContentSecurityPolicyHeaders({
    vercelEnv: process.env.VERCEL_ENV,
    gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF,
  })

  siteRoute.headers = [...STATIC_SITE_HEADERS, ...cspHeaders]

  writeFileSync(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`)

  const reportOnly = cspHeaders.find((header) => header.key === 'Content-Security-Policy-Report-Only')
  if (reportOnly?.value !== PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY) {
    throw new Error('Production report-only CSP drifted during Vercel header patch')
  }
}

patchVercelSiteSecurityHeaders()
