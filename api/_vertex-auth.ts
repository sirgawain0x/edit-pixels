/// <reference types="node" />
/**
 * Shared Vertex / Google Cloud auth — WIF on Vercel, ADC locally.
 */
// fallow-ignore-file complexity

import { getVercelOidcToken } from '@vercel/oidc'
import { ExternalAccountClient, GoogleAuth, type AnyAuthClient } from 'google-auth-library'

const DEFAULT_PROJECT = 'creative-ai-491118'
const DEFAULT_LOCATION = 'us-east1'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

/** Required on Vercel for Workload Identity Federation (all four must be set). */
const REQUIRED_WIF_ENV_KEYS = [
  'GCP_PROJECT_NUMBER',
  'GCP_WORKLOAD_IDENTITY_POOL_ID',
  'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
  'GCP_SERVICE_ACCOUNT_EMAIL',
] as const

type RequiredWifEnvKey = (typeof REQUIRED_WIF_ENV_KEYS)[number]

interface WifProviderIds {
  projectNumber: string
  poolId: string
  providerId: string
}

interface WifConfig extends WifProviderIds {
  serviceAccountEmail: string
  /** Vercel OIDC JWT `aud`. STS rejects this URL as the token-exchange audience. */
  oidcAudience: string
  /** Identity Provider resource name sent to https://sts.googleapis.com/v1/token. */
  stsAudience: string
}

/** Names of required WIF env vars that are unset or blank. */
export function listMissingWifEnvVars(): RequiredWifEnvKey[] {
  return REQUIRED_WIF_ENV_KEYS.filter((key) => !process.env[key]?.trim())
}

/**
 * User-facing hint when Vertex token acquisition fails.
 * On Vercel, names missing GCP_* keys when WIF config is incomplete.
 */
export function directorVertexAuthFailureHint(): string {
  return vertexAuthFailureHint()
}

function googleAuthErrorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (!error || typeof error !== 'object') return ''
  const record = error as { message?: unknown; cause?: unknown }
  const parts: string[] = []
  if (typeof record.message === 'string') parts.push(record.message)
  if (record.cause) parts.push(googleAuthErrorText(record.cause))
  return parts.join('\n')
}

/** True when WIF STS succeeded but IAM Credentials refused `:generateAccessToken`. */
export function isServiceAccountImpersonationDenied(error: unknown): boolean {
  return googleAuthErrorText(error).includes('iam.serviceAccounts.getAccessToken')
}

export function rethrowIfServiceAccountImpersonationDenied(error: unknown): void {
  if (isServiceAccountImpersonationDenied(error)) throw error
}

/** Client-safe copy when impersonating `GCP_SERVICE_ACCOUNT_EMAIL` is denied. */
export function vertexImpersonationFailureDetail(error: unknown): string | null {
  if (!isServiceAccountImpersonationDenied(error)) return null
  const serviceAccount =
    process.env.GCP_SERVICE_ACCOUNT_EMAIL?.trim() || 'GCP_SERVICE_ACCOUNT_EMAIL'
  return (
    `Permission iam.serviceAccounts.getAccessToken denied while impersonating ${serviceAccount}. ` +
    'Grant the Vercel OIDC WIF principal roles/iam.workloadIdentityUser on that service account. ' +
    'Firestore past briefs and Cloud Run ADK chat both need this impersonation binding when DIRECTOR_ADK_BASE_URL is set.'
  )
}

/** Shared Vertex/WIF auth failure hint (Director, Seedance/Pixels plan, Flow). */
export function vertexAuthFailureHint(): string {
  if (!process.env.VERCEL) {
    return (
      'Run `gcloud auth application-default login` (local ADC). ' +
      'GCP_* from `vercel env pull` are ignored off-Vercel.'
    )
  }
  const missing = listMissingWifEnvVars()
  if (missing.length > 0) {
    return `Missing GCP Workload Identity Federation env vars (Vercel OIDC): ${missing.join(', ')}.`
  }
  return (
    'GCP Workload Identity Federation env vars are set but auth failed. ' +
    'Grant the WIF principal roles/iam.workloadIdentityUser on GCP_SERVICE_ACCOUNT_EMAIL. ' +
    'Also check GCP_AUDIENCE (OIDC aud), Vercel OIDC, and DIRECTOR_ADK_BASE_URL for Cloud Run ADK.'
  )
}

/** Prefer the impersonation IAM detail when the thrown error names it. */
export function vertexAuthFailureMessage(error?: unknown): string {
  return (error ? vertexImpersonationFailureDetail(error) : null) ?? vertexAuthFailureHint()
}

/**
 * True when Cloud Run ADK / Vertex token minting failed for WIF or IAM reasons.
 * Gaxios impersonation denials do not use the "Cloud Run ID token" message prefix —
 * match `iam.serviceAccounts.getAccessToken` via {@link isServiceAccountImpersonationDenied}.
 */
export function isDirectorUpstreamAuthFailure(error: unknown): boolean {
  if (isServiceAccountImpersonationDenied(error)) return true
  if (!(error instanceof Error)) return false
  return (
    error.message.includes('Cloud Run ID token') ||
    error.message.includes('Workload Identity Federation') ||
    error.message.includes('Google Cloud access token')
  )
}

/** Audience Vercel stamps on the OIDC token. Must match the GCP provider allowlist. */
export function oidcAudienceForProvider(input: WifProviderIds, configuredAudience?: string): string {
  const configured = configuredAudience?.trim()
  if (configured) return configured
  return `https://iam.googleapis.com/projects/${input.projectNumber}/locations/global/workloadIdentityPools/${input.poolId}/providers/${input.providerId}`
}

/** Full resource name STS requires. Not interchangeable with the https OIDC audience. */
export function stsAudienceForProvider(input: WifProviderIds): string {
  return `//iam.googleapis.com/projects/${input.projectNumber}/locations/global/workloadIdentityPools/${input.poolId}/providers/${input.providerId}`
}

export function getVertexProject(): string {
  return (
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCP_PROJECT_ID?.trim() ||
    DEFAULT_PROJECT
  )
}

export function getVertexLocation(): string {
  return process.env.VERTEX_LOCATION?.trim() || DEFAULT_LOCATION
}

function readWifConfig(): WifConfig | null {
  const projectNumber = process.env.GCP_PROJECT_NUMBER?.trim()
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID?.trim()
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID?.trim()
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL?.trim()
  if (!projectNumber || !poolId || !providerId || !serviceAccountEmail) {
    return null
  }

  const provider = { projectNumber, poolId, providerId }
  return {
    ...provider,
    serviceAccountEmail,
    oidcAudience: oidcAudienceForProvider(provider, process.env.GCP_AUDIENCE),
    stsAudience: stsAudienceForProvider(provider),
  }
}

function tokenFromResponse(tokenResponse: unknown): string | null {
  if (typeof tokenResponse === 'string' && tokenResponse) return tokenResponse
  if (
    tokenResponse &&
    typeof tokenResponse === 'object' &&
    'token' in tokenResponse &&
    typeof (tokenResponse as { token?: unknown }).token === 'string'
  ) {
    return (tokenResponse as { token: string }).token
  }
  return null
}

function buildExternalAccountClient(config: WifConfig): AnyAuthClient {
  const client = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: config.stsAudience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: () =>
        getVercelOidcToken({
          audience: config.oidcAudience,
        }),
    },
  })

  if (!client) {
    throw new Error('Failed to create Workload Identity Federation client')
  }

  client.scopes = [CLOUD_PLATFORM_SCOPE]
  return client
}

async function getAccessTokenViaWif(config: WifConfig): Promise<string> {
  const client = buildExternalAccountClient(config)
  const token = tokenFromResponse(await client.getAccessToken())
  if (!token) {
    throw new Error('Failed to obtain access token via Workload Identity Federation')
  }
  return token
}

async function getAccessTokenViaAdc(): Promise<string> {
  const auth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] })
  const client = await auth.getClient()
  const token = tokenFromResponse(await client.getAccessToken())
  if (!token) {
    throw new Error('Failed to obtain Google Cloud access token via ADC')
  }
  return token
}

/** Prefer keyless WIF on Vercel; use ADC for local dev. */
export async function getVertexAccessToken(): Promise<string> {
  const wif = readWifConfig()
  if (wif && process.env.VERCEL) {
    return getAccessTokenViaWif(wif)
  }
  return getAccessTokenViaAdc()
}

export function isVertexAuthConfigured(): boolean {
  if (process.env.VERCEL) {
    return listMissingWifEnvVars().length === 0
  }
  // Local: ADC (`gcloud auth application-default login`); WIF vars are ignored off-Vercel.
  return true
}

function readBearerFromAuthHeaders(headers: Headers): string | null {
  const raw = headers.get('authorization') ?? headers.get('Authorization')
  if (!raw?.startsWith('Bearer ')) return null
  const token = raw.slice('Bearer '.length).trim()
  return token || null
}

async function generateIdTokenViaImpersonatedSa(
  serviceAccountEmail: string,
  accessToken: string,
  audience: string,
): Promise<string> {
  const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:generateIdToken`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audience, includeEmail: true }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Cloud Run ID token via IAM Credentials failed (${response.status}): ${detail}`)
  }
  const payload = (await response.json()) as { token?: string }
  if (!payload.token?.trim()) {
    throw new Error('Cloud Run ID token via IAM Credentials returned no token')
  }
  return payload.token.trim()
}

/**
 * OIDC ID token for authenticated Cloud Run invocations (audience = service base URL).
 * Vercel: WIF access token + IAM Credentials generateIdToken on GCP_SERVICE_ACCOUNT_EMAIL.
 * Local: Application Default Credentials via google-auth-library IdTokenClient.
 */
export async function getCloudRunIdToken(audience: string): Promise<string> {
  const targetAudience = audience.replace(/\/+$/, '')
  const wif = readWifConfig()
  if (wif && process.env.VERCEL) {
    const accessToken = await getAccessTokenViaWif(wif)
    return generateIdTokenViaImpersonatedSa(wif.serviceAccountEmail, accessToken, targetAudience)
  }

  const auth = new GoogleAuth()
  const client = await auth.getIdTokenClient(targetAudience)
  const headers = await client.getRequestHeaders()
  const token = readBearerFromAuthHeaders(headers)
  if (!token) {
    throw new Error('Failed to obtain Cloud Run ID token via ADC')
  }
  return token
}
