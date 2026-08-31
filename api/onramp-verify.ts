/// <reference types="node" />
/**
 * POST /api/onramp-verify — initiate Coinbase Onramp OTP verification (sms | email).
 *
 * Body: { channel: 'sms' | 'email', destination: string }
 */
// fallow-ignore-file complexity,duplicate-export

import {
  CDP_VERIFICATIONS_PATH,
  asTrimmedString,
  cdpFetch,
  forwardCdpError,
  getCdpCredentials,
  missingCredentialsResponse,
  normalizePhone,
  parseJsonBody,
} from './_coinbase-onramp.js'

interface InitiateVerificationResponse {
  verificationId?: string
  otpExpiresAt?: string
}

export async function POST(request: Request): Promise<Response> {
  if (!getCdpCredentials()) {
    return missingCredentialsResponse()
  }

  const body = await parseJsonBody(request)
  if (!body) {
    return Response.json({ error: 'Valid JSON body is required' }, { status: 400 })
  }

  const channel = asTrimmedString(body.channel)
  const destinationRaw = asTrimmedString(body.destination)

  if (channel !== 'sms' && channel !== 'email') {
    return Response.json({ error: 'channel must be sms or email' }, { status: 400 })
  }
  if (!destinationRaw) {
    return Response.json({ error: 'destination is required' }, { status: 400 })
  }

  let destination = destinationRaw
  if (channel === 'sms') {
    const phone = normalizePhone(destinationRaw)
    if (!phone) {
      return Response.json({ error: 'Valid US phone number is required' }, { status: 400 })
    }
    destination = phone
  } else if (!destinationRaw.includes('@')) {
    return Response.json({ error: 'Valid email is required' }, { status: 400 })
  }

  try {
    const res = await cdpFetch('POST', CDP_VERIFICATIONS_PATH, { channel, destination })
    const text = await res.text()
    if (!res.ok) {
      console.error('Coinbase onramp verify initiate error', res.status, text)
      return forwardCdpError(res.status, text, 'Failed to initiate onramp verification')
    }

    const data = JSON.parse(text) as InitiateVerificationResponse
    if (!data.verificationId) {
      return Response.json({ error: 'Invalid verification response' }, { status: 502 })
    }

    return Response.json({
      verificationId: data.verificationId,
      otpExpiresAt: data.otpExpiresAt ?? null,
      channel,
      destination,
    })
  } catch (e) {
    console.error('Onramp verify initiate error', e)
    return Response.json({ error: 'Failed to initiate onramp verification' }, { status: 500 })
  }
}
