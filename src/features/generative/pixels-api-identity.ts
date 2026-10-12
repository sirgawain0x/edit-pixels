/**
 * Attach Privy token + active signer hint to Pixels generate / Director API calls.
 */
import type { SignedRequestParams } from './services/generative-proxy-client'

export const PIXELS_SIGNER_HEADER = 'x-pixels-signer'

export async function pixelsIdentityHeaders(
  auth: SignedRequestParams,
): Promise<Record<string, string>> {
  const token = await auth.getAccessToken()
  if (!token) {
    throw new Error('Not authenticated')
  }
  return {
    Authorization: `Bearer ${token}`,
    [PIXELS_SIGNER_HEADER]: auth.signerAddress,
  }
}

export async function withPixelsIdentityBody<T extends Record<string, unknown>>(
  auth: SignedRequestParams,
  payload: T,
): Promise<T & { token: string; signerAddress: `0x${string}` }> {
  const token = await auth.getAccessToken()
  if (!token) {
    throw new Error('Not authenticated')
  }
  return {
    ...payload,
    token,
    signerAddress: auth.signerAddress,
  }
}
