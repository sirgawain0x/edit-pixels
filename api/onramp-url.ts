/// <reference types="node" />
/**
 * POST /api/onramp-url — create a Coinbase CDP headless onramp order and return paymentLink.
 *
 * Requires COINBASE_CDP_API_KEY_ID and COINBASE_CDP_API_KEY_SECRET env vars.
 *
 * Body:
 *   address, email, phone, amount, paymentMethod,
 *   agreementAcceptedAt, phoneNumberVerifiedAt,
 *   smsVerificationId, emailVerificationId,
 *   partnerUserRef?, redirectUrl?
 */
// fallow-ignore-file complexity,duplicate-export

import {
  CDP_ORDER_PATH,
  DEFAULT_ONRAMP_ASSET,
  DEFAULT_ONRAMP_NETWORK,
  DEFAULT_ONRAMP_PAYMENT_METHOD,
  PAY_ORIGIN,
  asTrimmedString,
  cdpFetch,
  forwardCdpError,
  getCdpCredentials,
  getOnrampDomain,
  isAllowedPaymentMethod,
  missingCredentialsResponse,
  normalizeAmount,
  normalizePhone,
  parseJsonBody,
} from './_coinbase-onramp.js'

interface OnrampOrderRequest {
  partnerUserRef: string
  email: string
  phoneNumber: string
  paymentAmount: string
  paymentCurrency: string
  paymentMethod: string
  purchaseCurrency: string
  destinationAddress: string
  destinationNetwork: string
  domain: string
  isQuote: boolean
  agreementAcceptedAt: string
  phoneNumberVerifiedAt: string
  smsVerificationId: string
  emailVerificationId: string
}

interface OnrampOrderResponse {
  order?: { orderId?: string; status?: string }
  paymentLink?: { url?: string; paymentLinkType?: string }
  error?: string
  errorMessage?: string
}

function isIsoTimestamp(value: string): boolean {
  const t = Date.parse(value)
  return Number.isFinite(t)
}

function isVerificationId(value: string): boolean {
  return /^onramp_verification_[a-f0-9-]{36}$/i.test(value)
}

export async function POST(request: Request): Promise<Response> {
  if (!getCdpCredentials()) {
    return missingCredentialsResponse()
  }

  try {
    const body = await parseJsonBody(request)
    if (!body) {
      return Response.json({ error: 'Valid JSON body is required' }, { status: 400 })
    }

    const address = asTrimmedString(body.address)
    const email = asTrimmedString(body.email)
    const phoneRaw = asTrimmedString(body.phone)
    const amountRaw = asTrimmedString(body.amount)
    const paymentMethod = asTrimmedString(body.paymentMethod) || DEFAULT_ONRAMP_PAYMENT_METHOD
    const agreementAcceptedAt = asTrimmedString(body.agreementAcceptedAt)
    const phoneNumberVerifiedAt = asTrimmedString(body.phoneNumberVerifiedAt)
    const smsVerificationId = asTrimmedString(body.smsVerificationId)
    const emailVerificationId = asTrimmedString(body.emailVerificationId)
    const redirectUrl = asTrimmedString(body.redirectUrl)
    const partnerUserRef =
      asTrimmedString(body.partnerUserRef) || (address ? address.slice(0, 50) : '')

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return Response.json({ error: 'Valid destination address is required' }, { status: 400 })
    }
    if (!email || !email.includes('@')) {
      return Response.json({ error: 'Valid email is required' }, { status: 400 })
    }

    const phone = normalizePhone(phoneRaw)
    if (!phone) {
      return Response.json({ error: 'Valid US phone number is required' }, { status: 400 })
    }

    const amountValue = normalizeAmount(amountRaw)
    if (!amountValue) {
      return Response.json({ error: 'Valid fiat amount is required' }, { status: 400 })
    }

    if (!isAllowedPaymentMethod(paymentMethod)) {
      return Response.json(
        { error: 'paymentMethod must be GUEST_CHECKOUT_APPLE_PAY or GUEST_CHECKOUT_GOOGLE_PAY' },
        { status: 400 },
      )
    }

    if (!agreementAcceptedAt || !isIsoTimestamp(agreementAcceptedAt)) {
      return Response.json(
        { error: 'agreementAcceptedAt ISO timestamp is required' },
        { status: 400 },
      )
    }
    if (!phoneNumberVerifiedAt || !isIsoTimestamp(phoneNumberVerifiedAt)) {
      return Response.json(
        { error: 'phoneNumberVerifiedAt ISO timestamp is required' },
        { status: 400 },
      )
    }
    if (!smsVerificationId || !isVerificationId(smsVerificationId)) {
      return Response.json({ error: 'Valid smsVerificationId is required' }, { status: 400 })
    }
    if (!emailVerificationId || !isVerificationId(emailVerificationId)) {
      return Response.json({ error: 'Valid emailVerificationId is required' }, { status: 400 })
    }

    const orderBody: OnrampOrderRequest = {
      partnerUserRef,
      email,
      phoneNumber: phone,
      paymentAmount: amountValue,
      paymentCurrency: 'USD',
      paymentMethod,
      purchaseCurrency: DEFAULT_ONRAMP_ASSET,
      destinationAddress: address,
      destinationNetwork: DEFAULT_ONRAMP_NETWORK,
      domain: getOnrampDomain(),
      isQuote: false,
      agreementAcceptedAt,
      phoneNumberVerifiedAt,
      smsVerificationId,
      emailVerificationId,
    }

    const orderRes = await cdpFetch('POST', CDP_ORDER_PATH, orderBody)
    const errText = await orderRes.text()
    if (!orderRes.ok) {
      console.error('Coinbase onramp order error', orderRes.status, errText)
      return forwardCdpError(orderRes.status, errText, 'Failed to create onramp order')
    }

    let data: OnrampOrderResponse
    try {
      data = JSON.parse(errText) as OnrampOrderResponse
    } catch {
      console.error('Coinbase onramp invalid JSON response', errText)
      return Response.json({ error: 'Invalid onramp order response' }, { status: 502 })
    }

    const paymentLinkUrl = data.paymentLink?.url
    if (!paymentLinkUrl || typeof paymentLinkUrl !== 'string') {
      console.error('Coinbase onramp invalid response', JSON.stringify(data))
      return Response.json({ error: 'Invalid onramp order response' }, { status: 502 })
    }

    const paymentUrl = new URL(paymentLinkUrl)
    if (redirectUrl) {
      paymentUrl.searchParams.set('redirectUrl', redirectUrl)
    }

    // Sandbox payment sheet for local/dev testing when partnerUserRef is sandbox-prefixed.
    if (partnerUserRef.startsWith('sandbox-')) {
      if (paymentMethod === 'GUEST_CHECKOUT_APPLE_PAY') {
        paymentUrl.searchParams.set('useApplePaySandbox', 'true')
      } else if (paymentMethod === 'GUEST_CHECKOUT_GOOGLE_PAY') {
        paymentUrl.searchParams.set('useGooglePaySandbox', 'true')
      }
    }

    return Response.json({
      paymentLink: paymentUrl.toString(),
      orderId: data.order?.orderId ?? null,
      origin: PAY_ORIGIN,
    })
  } catch (e) {
    console.error('Onramp order error', e)
    return Response.json({ error: 'Failed to generate onramp order' }, { status: 500 })
  }
}
