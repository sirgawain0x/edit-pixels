export declare const PRODUCTION_CONTENT_SECURITY_POLICY_REPORT_ONLY: string
export declare const LEGACY_STAGING_CONTENT_SECURITY_POLICY_REPORT_ONLY: string
export declare const HCAPTCHA_SCRIPT_EVAL_SOURCE: "'wasm-unsafe-eval'"
export declare const HCAPTCHA_ORIGINS: readonly ['https://hcaptcha.com', 'https://*.hcaptcha.com']
export declare const STAGING_PREVIEW_EXTRA_PRIVY_ORIGINS: readonly ['https://*.privy.io']

export interface SiteSecurityHeader {
  key: string
  value: string
}

export interface ResolveSiteSecurityHeadersInput {
  vercelEnv?: string
  gitCommitRef?: string
}

export function parseContentSecurityPolicyDirectives(policy: string): Map<string, string[]>

export function buildPreviewStagingReportOnlyContentSecurityPolicy(
  basePolicy?: string,
): string

export function shouldUsePreviewStagingReportOnlyContentSecurityPolicy(
  input: ResolveSiteSecurityHeadersInput,
): boolean

export function resolveReportOnlyContentSecurityPolicyForDeployment(
  input?: ResolveSiteSecurityHeadersInput,
): string

export function resolveContentSecurityPolicyHeaders(
  input: ResolveSiteSecurityHeadersInput,
): SiteSecurityHeader[]
