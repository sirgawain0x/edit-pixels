import { describe, expect, it } from 'vitest'
import { oidcAudienceForProvider, stsAudienceForProvider } from '../../../../api/_vertex-auth'

const provider = {
  projectNumber: '1037240986506',
  poolId: 'vercel',
  providerId: 'vercel',
}

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
