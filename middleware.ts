import { next } from '@vercel/functions'
import { resolveReportOnlyContentSecurityPolicyForDeployment } from './content-security-policy.js'

export default async function middleware(_request: Request): Promise<Response> {
  const policy = resolveReportOnlyContentSecurityPolicyForDeployment({
    vercelEnv: process.env.VERCEL_ENV,
    gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF,
  })
  return next({
    headers: {
      'Content-Security-Policy-Report-Only': policy,
    },
  })
}

export const config = {
  matcher: ['/((?!api/|_vercel/insights).*)'],
}
