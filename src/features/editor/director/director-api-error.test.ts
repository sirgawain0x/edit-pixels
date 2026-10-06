import { describe, expect, it } from 'vitest'
import { directorFailureMessage } from './director-api-error'

describe('directorFailureMessage', () => {
  it('uses a string error field', () => {
    expect(directorFailureMessage(402, { error: 'Director payment rejected: too low' })).toBe(
      'Director payment rejected: too low',
    )
  })

  it('renders WIF impersonation 503 copy from the error field', () => {
    const error =
      'Director auth failed: Permission iam.serviceAccounts.getAccessToken denied while impersonating vercel@creative-ai-491118.iam.gserviceaccount.com. Grant the Vercel OIDC WIF principal roles/iam.workloadIdentityUser on that service account. Firestore past briefs and Cloud Run ADK chat both need this impersonation binding when DIRECTOR_ADK_BASE_URL is set.'
    expect(directorFailureMessage(503, { error })).toBe(error)
    expect(directorFailureMessage(503, { error })).toContain('iam.serviceAccounts.getAccessToken')
    expect(directorFailureMessage(503, { error })).toContain('DIRECTOR_ADK_BASE_URL')
  })

  it('renders Cloud Run getOpenIdToken 503 copy from the error field', () => {
    const error =
      'Director auth failed: Permission iam.serviceAccounts.getOpenIdToken denied while minting a Cloud Run ID token for vercel@creative-ai-491118.iam.gserviceaccount.com. Grant that service account roles/iam.serviceAccountTokenCreator on itself, and roles/run.invoker on the Cloud Run service. Required when DIRECTOR_ADK_BASE_URL is set (WIF access token alone is not enough).'
    expect(directorFailureMessage(503, { error })).toBe(error)
    expect(directorFailureMessage(503, { error })).toContain('iam.serviceAccounts.getOpenIdToken')
    expect(directorFailureMessage(503, { error })).toContain('serviceAccountTokenCreator')
  })

  it('reads Vercel invocation errors without returning the object', () => {
    const message = directorFailureMessage(500, {
      error: { code: 'FUNCTION_INVOCATION_FAILED', message: 'A server error has occurred' },
    })
    expect(message).toContain('Director crashed before streaming')
    expect(typeof message).toBe('string')
  })

  it('falls back to the status when the body is empty', () => {
    expect(directorFailureMessage(500, null)).toBe('Director request failed (500)')
  })
})
