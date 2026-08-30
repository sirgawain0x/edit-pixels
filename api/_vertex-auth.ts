/// <reference types="node" />
/**
 * Shared Vertex / Google Cloud auth — WIF on Vercel, ADC locally.
 */
// fallow-ignore-file unused-export

import { getVercelOidcToken } from '@vercel/oidc'
import { ExternalAccountClient, GoogleAuth } from 'google-auth-library'

const DEFAULT_PROJECT = 'creative-ai-491118'
const DEFAULT_LOCATION = 'us-central1'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

interface WifConfig {
  projectNumber: string
  poolId: string
  providerId: string
  serviceAccountEmail: string
  audience: string
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

  const audience =
    process.env.GCP_AUDIENCE?.trim() ||
    `https://iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`

  return { projectNumber, poolId, providerId, serviceAccountEmail, audience }
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

async function getAccessTokenViaWif(config: WifConfig): Promise<string> {
  const client = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: config.audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: () =>
        getVercelOidcToken({
          audience: config.audience,
        }),
    },
  })

  if (!client) {
    throw new Error('Failed to create Workload Identity Federation client')
  }

  client.scopes = [CLOUD_PLATFORM_SCOPE]
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
  if (readWifConfig() && process.env.VERCEL) return true
  return true
}
