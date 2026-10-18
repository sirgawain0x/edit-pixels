/** Frozen production report-only CSP (origin/prod `vercel.json`, 2026-10-16). */
export const PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://esm.sh https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://hcaptcha.com https://*.hcaptcha.com; img-src 'self' data: blob: https://explorer-api.walletconnect.com; font-src 'self' data: https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; child-src https://auth.privy.io https://privy.create.creativeplatform.xyz https://verify.walletconnect.com https://verify.walletconnect.org https://pay.coinbase.com https://*.coinbase.com https://accounts.google.com https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com; frame-src https://auth.privy.io https://privy.create.creativeplatform.xyz https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://pay.coinbase.com https://*.coinbase.com https://accounts.google.com https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com; connect-src 'self' blob: data: https://auth.privy.io https://privy.create.creativeplatform.xyz wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com https://api.github.com https://*.g.alchemy.com https://arb1.arbitrum.io https://huggingface.co https://*.huggingface.co https://cdn.jsdelivr.net https://esm.sh https://*.esm.sh https://graphql.lottiefiles.com https://accounts.google.com https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com https://hcaptcha.com https://*.hcaptcha.com; worker-src 'self' blob:; media-src 'self' blob: data:; manifest-src 'self'"

/**
 * Report-only CSP previously committed on `origin/staging` before the preview/staging
 * report-only split (includes `https://*.privy.io` on iframe/connect directives).
 */
export const LEGACY_STAGING_CONTENT_SECURITY_POLICY_REPORT_ONLY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://esm.sh https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://hcaptcha.com https://*.hcaptcha.com; img-src 'self' data: blob: https://explorer-api.walletconnect.com; font-src 'self' data: https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; child-src https://auth.privy.io https://*.privy.io https://privy.create.creativeplatform.xyz https://verify.walletconnect.com https://verify.walletconnect.org https://pay.coinbase.com https://*.coinbase.com https://accounts.google.com https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com; frame-src https://auth.privy.io https://*.privy.io https://privy.create.creativeplatform.xyz https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://pay.coinbase.com https://*.coinbase.com https://accounts.google.com https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com; connect-src 'self' blob: data: https://auth.privy.io https://*.privy.io https://privy.create.creativeplatform.xyz wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com https://api.github.com https://*.g.alchemy.com https://arb1.arbitrum.io https://huggingface.co https://*.huggingface.co https://cdn.jsdelivr.net https://esm.sh https://*.esm.sh https://graphql.lottiefiles.com https://accounts.google.com https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com https://hcaptcha.com https://*.hcaptcha.com; worker-src 'self' blob:; media-src 'self' blob: data:; manifest-src 'self'"

export const HCAPTCHA_SCRIPT_EVAL_SOURCE = "'wasm-unsafe-eval'"

export const HCAPTCHA_ORIGINS = ['https://hcaptcha.com', 'https://*.hcaptcha.com']

/** Staging-only Privy wildcard host used by preview/staging login flows. */
export const STAGING_PREVIEW_EXTRA_PRIVY_ORIGINS = ['https://*.privy.io']

const STAGING_PREVIEW_PRIVY_DIRECTIVES = ['child-src', 'frame-src', 'connect-src']

const HCAPTCHA_DIRECTIVES = ['script-src', 'frame-src', 'connect-src', 'style-src']

export function parseContentSecurityPolicyDirectives(policy) {
  const entries = []
  for (const part of policy.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const [name, ...rest] = trimmed.split(/\s+/)
    if (!name) continue
    entries.push([name, rest])
  }
  return new Map(entries)
}

function serializeDirectives(directives) {
  return [...directives.entries()]
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ')
}

function appendUniqueSources(sources, required) {
  const next = [...sources]
  for (const source of required) {
    if (!next.includes(source)) next.push(source)
  }
  return next
}

/**
 * Preview/staging report-only CSP: production base + staging Privy wildcard hosts +
 * Privy-documented hCaptcha directives (including `style-src`).
 */
export function buildPreviewStagingReportOnlyContentSecurityPolicy(
  basePolicy = PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY,
) {
  const directives = parseContentSecurityPolicyDirectives(basePolicy)

  for (const directive of STAGING_PREVIEW_PRIVY_DIRECTIVES) {
    const sources = directives.get(directive) ?? []
    directives.set(directive, appendUniqueSources(sources, STAGING_PREVIEW_EXTRA_PRIVY_ORIGINS))
  }

  for (const directive of HCAPTCHA_DIRECTIVES) {
    const sources = directives.get(directive) ?? []
    let next = appendUniqueSources(sources, HCAPTCHA_ORIGINS)
    if (directive === 'script-src') {
      next = appendUniqueSources(next, [HCAPTCHA_SCRIPT_EVAL_SOURCE])
    }
    directives.set(directive, next)
  }

  return serializeDirectives(directives)
}

export function shouldUsePreviewStagingReportOnlyContentSecurityPolicy(input) {
  if (input.vercelEnv === 'preview') return true
  if (input.gitCommitRef === 'staging') return true
  return false
}

export function resolveReportOnlyContentSecurityPolicyForDeployment(input = {}) {
  return shouldUsePreviewStagingReportOnlyContentSecurityPolicy(input)
    ? buildPreviewStagingReportOnlyContentSecurityPolicy()
    : PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY
}

export function resolveContentSecurityPolicyHeaders(input) {
  return [
    {
      key: 'Content-Security-Policy-Report-Only',
      value: resolveReportOnlyContentSecurityPolicyForDeployment(input),
    },
  ]
}
