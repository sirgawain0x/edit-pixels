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
    'Check GCP_AUDIENCE (OIDC aud), Vercel OIDC, and SA impersonation IAM.'
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
