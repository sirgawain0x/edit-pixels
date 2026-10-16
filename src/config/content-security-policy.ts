/** Frozen production report-only CSP (origin/prod `vercel.json`, 2026-10-16). */
export const PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://esm.sh https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://hcaptcha.com https://*.hcaptcha.com; img-src 'self' data: blob: https://explorer-api.walletconnect.com; font-src 'self' data: https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; child-src https://auth.privy.io https://privy.create.creativeplatform.xyz https://verify.walletconnect.com https://verify.walletconnect.org https://pay.coinbase.com https://*.coinbase.com https://accounts.google.com https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com; frame-src https://auth.privy.io https://privy.create.creativeplatform.xyz https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com https://pay.coinbase.com https://*.coinbase.com https://accounts.google.com https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com; connect-src 'self' blob: data: https://auth.privy.io https://privy.create.creativeplatform.xyz wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com https://api.github.com https://*.g.alchemy.com https://arb1.arbitrum.io https://huggingface.co https://*.huggingface.co https://cdn.jsdelivr.net https://esm.sh https://*.esm.sh https://graphql.lottiefiles.com https://accounts.google.com https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com https://hcaptcha.com https://*.hcaptcha.com; worker-src 'self' blob:; media-src 'self' blob: data:; manifest-src 'self'"

export const HCAPTCHA_SCRIPT_EVAL_SOURCE = "'wasm-unsafe-eval'" as const

export const HCAPTCHA_ORIGINS = ['https://hcaptcha.com', 'https://*.hcaptcha.com'] as const

const HCAPTCHA_SCRIPT_STYLE_FRAME_CONNECT = [
  'script-src',
  'frame-src',
  'connect-src',
] as const

export interface SiteSecurityHeader {
  key: string
  value: string
}

export interface ResolveSiteSecurityHeadersInput {
  vercelEnv?: string
  gitCommitRef?: string
}

function parseDirectives(policy: string): Map<string, string[]> {
  const entries: Array<[string, string[]]> = []
  for (const part of policy.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const [name, ...rest] = trimmed.split(/\s+/)
    if (!name) continue
    entries.push([name, rest])
  }
  return new Map(entries)
}

function serializeDirectives(directives: Map<string, string[]>): string {
  return [...directives.entries()]
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ')
}

function appendUniqueSources(sources: string[], required: readonly string[]): string[] {
  const next = [...sources]
  for (const source of required) {
    if (!next.includes(source)) next.push(source)
  }
  return next
}

/**
 * Ensures Privy hCaptcha origins (and wasm eval for hCaptcha) are present on the
 * directives Privy documents for CAPTCHA providers.
 */
export function buildHcaptchaEnforcedContentSecurityPolicy(
  basePolicy: string = PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY,
): string {
  const directives = parseDirectives(basePolicy)

  for (const directive of HCAPTCHA_SCRIPT_STYLE_FRAME_CONNECT) {
    const sources = directives.get(directive) ?? []
    let next = appendUniqueSources(sources, HCAPTCHA_ORIGINS)
    if (directive === 'script-src') {
      next = appendUniqueSources(next, [HCAPTCHA_SCRIPT_EVAL_SOURCE])
    }
    directives.set(directive, next)
  }

  for (const directive of ['style-src'] as const) {
    const sources = directives.get(directive) ?? []
    directives.set(directive, appendUniqueSources(sources, HCAPTCHA_ORIGINS))
  }

  return serializeDirectives(directives)
}

export function shouldApplyHcaptchaEnforcedContentSecurityPolicy(
  input: ResolveSiteSecurityHeadersInput,
): boolean {
  if (input.vercelEnv === 'preview') return true
  if (input.gitCommitRef === 'staging') return true
  return false
}

export function resolveContentSecurityPolicyHeaders(
  input: ResolveSiteSecurityHeadersInput,
): SiteSecurityHeader[] {
  const headers: SiteSecurityHeader[] = [
    {
      key: 'Content-Security-Policy-Report-Only',
      value: PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY,
    },
  ]

  if (shouldApplyHcaptchaEnforcedContentSecurityPolicy(input)) {
    headers.push({
      key: 'Content-Security-Policy',
      value: buildHcaptchaEnforcedContentSecurityPolicy(),
    })
  }

  return headers
}
