/// <reference types="node" />
/**
 * POST /api/onramp-verify-submit — submit OTP for an Onramp verification.
 *
 * Body: { verificationId: string, otpCode: string }
 */
import {
  CDP_VERIFICATIONS_PATH,
  asTrimmedString,
  cdpFetch,
  forwardCdpError,
  getCdpCredentials,
  missingCredentialsResponse,
  parseJsonBody,
} from './_coinbase-onramp.js'

interface SubmitVerificationResponse {
  verificationId?: string
  verificationExpiresAt?: string
}

export async function POST(request: Request): Promise<Response> {
  if (!getCdpCredentials()) {
    return missingCredentialsResponse()
  }

  const body = await parseJsonBody(request)
  if (!body) {
    return Response.json({ error: 'Valid JSON body is required' }, { status: 400 })
  }

  const verificationId = asTrimmedString(body.verificationId)
  const otpCode = asTrimmedString(body.otpCode)

  if (!verificationId || !verificationId.startsWith('onramp_verification_')) {
    return Response.json({ error: 'Valid verificationId is required' }, { status: 400 })
  }
  if (!otpCode || !/^\d{6}$/.test(otpCode)) {
    return Response.json({ error: 'otpCode must be a 6-digit code' }, { status: 400 })
  }

  const requestPath = `${CDP_VERIFICATIONS_PATH}/${encodeURIComponent(verificationId)}/submit`

  try {
    const res = await cdpFetch('POST', requestPath, { otpCode })
    const text = await res.text()
    if (!res.ok) {
      console.error('Coinbase onramp verify submit error', res.status, text)
      return forwardCdpError(res.status, text, 'Failed to submit onramp verification')
    }

    const data = JSON.parse(text) as SubmitVerificationResponse
    return Response.json({
      verificationId: data.verificationId ?? verificationId,
      verificationExpiresAt: data.verificationExpiresAt ?? null,
      verifiedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('Onramp verify submit error', e)
    return Response.json({ error: 'Failed to submit onramp verification' }, { status: 500 })
  }
}
