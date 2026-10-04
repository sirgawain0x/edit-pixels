import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  directorVertexAuthFailureHint,
  isServiceAccountImpersonationDenied,
  listMissingWifEnvVars,
  oidcAudienceForProvider,
  rethrowIfServiceAccountImpersonationDenied,
  stsAudienceForProvider,
  vertexAuthFailureHint,
  vertexAuthFailureMessage,
  vertexImpersonationFailureDetail,
} from '../../../../api/_vertex-auth'

const provider = {
  projectNumber: '1037240986506',
  poolId: 'vercel',
  providerId: 'vercel',
}

const WIF_ENV_KEYS = [
  'GCP_PROJECT_NUMBER',
  'GCP_WORKLOAD_IDENTITY_POOL_ID',
  'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
  'GCP_SERVICE_ACCOUNT_EMAIL',
] as const

describe('workload identity audiences', () => {
  it('keeps the https URL for the Vercel OIDC token aud', () => {
    expect(oidcAudienceForProvider(provider)).toBe(
      'https://iam.googleapis.com/projects/1037240986506/locations/global/workloadIdentityPools/vercel/providers/vercel',
    )
    expect(
      oidcAudienceForProvider(provider, ' https://iam.googleapis.com/projects/1037240986506/custom '),
    ).toBe('https://iam.googleapis.com/projects/1037240986506/custom')
  })

  it('sends STS the provider resource name, not the https URL', () => {
    expect(stsAudienceForProvider(provider)).toBe(
      '//iam.googleapis.com/projects/1037240986506/locations/global/workloadIdentityPools/vercel/providers/vercel',
    )
    expect(stsAudienceForProvider(provider).startsWith('//iam.googleapis.com/')).toBe(true)
    expect(stsAudienceForProvider(provider).startsWith('https://')).toBe(false)
  })
})

describe('missing WIF env messaging', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('lists every required key when all are unset', () => {
    for (const key of WIF_ENV_KEYS) {
      vi.stubEnv(key, '')
    }
    expect(listMissingWifEnvVars()).toEqual([...WIF_ENV_KEYS])
  })

  it('lists only the blank required keys', () => {
    vi.stubEnv('GCP_PROJECT_NUMBER', '1037240986506')
    vi.stubEnv('GCP_WORKLOAD_IDENTITY_POOL_ID', 'vercel')
    vi.stubEnv('GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID', '')
    vi.stubEnv('GCP_SERVICE_ACCOUNT_EMAIL', '  ')
    expect(listMissingWifEnvVars()).toEqual([
      'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
      'GCP_SERVICE_ACCOUNT_EMAIL',
    ])
  })

  it('names missing keys in the Vercel auth failure hint', () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('GCP_PROJECT_NUMBER', '1037240986506')
    vi.stubEnv('GCP_WORKLOAD_IDENTITY_POOL_ID', '')
    vi.stubEnv('GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID', 'vercel')
    vi.stubEnv('GCP_SERVICE_ACCOUNT_EMAIL', '')
    expect(vertexAuthFailureHint()).toBe(
      'Missing GCP Workload Identity Federation env vars (Vercel OIDC): GCP_WORKLOAD_IDENTITY_POOL_ID, GCP_SERVICE_ACCOUNT_EMAIL.',
    )
    expect(directorVertexAuthFailureHint()).toBe(vertexAuthFailureHint())
  })

  it('points at audience/IAM when all required WIF keys are present on Vercel', () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('GCP_PROJECT_NUMBER', '1037240986506')
    vi.stubEnv('GCP_WORKLOAD_IDENTITY_POOL_ID', 'vercel')
    vi.stubEnv('GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID', 'vercel')
    vi.stubEnv('GCP_SERVICE_ACCOUNT_EMAIL', 'sa@example.iam.gserviceaccount.com')
    expect(vertexAuthFailureHint()).toContain('GCP_AUDIENCE')
    expect(vertexAuthFailureHint()).toContain('roles/iam.workloadIdentityUser')
    expect(vertexAuthFailureHint()).toContain('DIRECTOR_ADK_BASE_URL')
  })

  it('keeps the local ADC hint off-Vercel', () => {
    vi.stubEnv('VERCEL', '')
    expect(vertexAuthFailureHint()).toContain('gcloud auth application-default login')
  })
})

describe('WIF service-account impersonation failures', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const impersonationError = {
    message: "Permission 'iam.serviceAccounts.getAccessToken' denied on resource (or it may not exist).",
    cause: {
      message:
        "Permission 'iam.serviceAccounts.getAccessToken' denied on resource (or it may not exist).",
      code: 403,
      status: 'PERMISSION_DENIED',
    },
  }

  it('detects IAM Credentials generateAccessToken denials', () => {
    expect(isServiceAccountImpersonationDenied(impersonationError)).toBe(true)
    expect(isServiceAccountImpersonationDenied(new Error('STS audience mismatch'))).toBe(false)
  })

  it('rethrows impersonation denials and ignores other errors', () => {
    expect(() => rethrowIfServiceAccountImpersonationDenied(new Error('timeout'))).not.toThrow()
    try {
      rethrowIfServiceAccountImpersonationDenied(impersonationError)
      throw new Error('expected impersonation denial to rethrow')
    } catch (caught) {
      expect(caught).toBe(impersonationError)
    }
  })

  it('names getAccessToken and the Cloud Run chat env in the client message', () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('GCP_PROJECT_NUMBER', '1037240986506')
    vi.stubEnv('GCP_WORKLOAD_IDENTITY_POOL_ID', 'vercel')
    vi.stubEnv('GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID', 'vercel')
    vi.stubEnv(
      'GCP_SERVICE_ACCOUNT_EMAIL',
      'vercel@creative-ai-491118.iam.gserviceaccount.com',
    )
    const detail = vertexImpersonationFailureDetail(impersonationError)
    expect(detail).toContain('iam.serviceAccounts.getAccessToken')
    expect(detail).toContain('vercel@creative-ai-491118.iam.gserviceaccount.com')
    expect(detail).toContain('roles/iam.workloadIdentityUser')
    expect(detail).toContain('DIRECTOR_ADK_BASE_URL')
    expect(vertexAuthFailureMessage(impersonationError)).toBe(detail)
    expect(vertexAuthFailureMessage(impersonationError)).toMatch(
      /^Permission iam.serviceAccounts.getAccessToken denied/,
    )
  })
})
