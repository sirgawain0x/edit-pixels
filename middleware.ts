import { next } from '@vercel/functions'
import { resolveReportOnlyContentSecurityPolicyForDeployment } from './content-security-policy.ts'

export default async function middleware(request: Request): Promise<Response> {
  const response = await next({ request })
  const policy = resolveReportOnlyContentSecurityPolicyForDeployment({
    vercelEnv: process.env.VERCEL_ENV,
    gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF,
  })
  response.headers.set('Content-Security-Policy-Report-Only', policy)
  return response
}

export const config = {
  matcher: ['/((?!_vercel/insights).*)'],
}
