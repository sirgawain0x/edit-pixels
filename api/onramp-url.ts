/// <reference types="node" />
/**
 * Vercel serverless endpoint: returns a Coinbase CDP headless onramp
 * paymentLink for buying USDC on Base.
 *
 * Requires COINBASE_CDP_API_KEY_ID and COINBASE_CDP_API_KEY_SECRET env vars.
 *
 * Query params:
 *   address            - destination wallet (0x...)
 *   email              - user's email for Coinbase verification
 *   phone              - US phone number (digits only, E.164 without +)
 *   amount             - fiat amount (e.g. "10.00")
 *   paymentMethod      - GUEST_CHECKOUT_APPLE_PAY | GUEST_CHECKOUT_GOOGLE_PAY
 *   partnerUserRef     - optional unique user ref (falls back to address)
 *   redirectUrl        - optional redirect after popup/card flow
 */

import { generateJwt } from '@coinbase/cdp-sdk/auth'

const CDP_HOST = 'api.cdp.coinbase.com'
const CDP_ORDER_PATH = '/platform/v2/onramp/orders'
const CDP_BASE_URL = `https://${CDP_HOST}${CDP_ORDER_PATH}`
const PAY_ORIGIN = 'https://pay.coinbase.com'

const DEFAULT_NETWORK = 'base'
const DEFAULT_ASSET = 'USDC'
const DEFAULT_PAYMENT_METHOD = 'GUEST_CHECKOUT_APPLE_PAY'
const DEFAULT_DOMAIN = 'create.creativeplatform.xyz'

interface OnrampOrderRequest {
  partnerUserRef: string
  user: { email: string; phoneNumber: string }
  amount: { value: string; currency: string }
  paymentMethod: string
  destination: {
    address: string
    network: string
    asset: string
  }
  domain?: string
}

interface OnrampOrderResponse {
  paymentLink?: string
  orderId?: string
  error?: string
}

function getDomain(): string {
  const env = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL ?? ''
  if (!env) return DEFAULT_DOMAIN
  try {
    return new URL(env.startsWith('http') ? env : `https://${env}`).hostname
  } catch {
    return env.replace(/^https?:\/\//, '').split('/')[0] || DEFAULT_DOMAIN
  }
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (/^1\d{10}$/.test(digits)) return `+${digits}`
  if (/^\d{10}$/.test(digits)) return `+1${digits}`
  return null
}

function normalizeAmount(value: string | null | undefined): string | null {
  if (!value) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n.toFixed(2)
}

export async function GET(request: Request): Promise<Response> {
  // Accept either env var name: the CDP SDK itself falls back from
  // CDP_API_KEY_ID to CDP_API_KEY_NAME, and Vercel has the _NAME variant set.
  const apiKeyId = process.env.COINBASE_CDP_API_KEY_ID ?? process.env.COINBASE_CDP_API_KEY_NAME
  const apiKeySecret = process.env.COINBASE_CDP_API_KEY_SECRET

  if (!apiKeyId || !apiKeySecret) {
    return Response.json(
      { error: 'Onramp not configured: missing CDP API credentials' },
      { status: 503 },
    )
  }

  try {
    const url = new URL(request.url)
    const address = url.searchParams.get('address')?.trim()
    const email = url.searchParams.get('email')?.trim()
    const phoneRaw = url.searchParams.get('phone')?.trim()
    const amountRaw = url.searchParams.get('amount')?.trim()
    const paymentMethod = url.searchParams.get('paymentMethod')?.trim() || DEFAULT_PAYMENT_METHOD
    const partnerUserRef =
      url.searchParams.get('partnerUserRef')?.trim() || (address ? address.slice(0, 50) : '')
    const redirectUrl = url.searchParams.get('redirectUrl')?.trim()

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

    const orderBody: OnrampOrderRequest = {
      partnerUserRef,
      user: { email, phoneNumber: phone },
      amount: { value: amountValue, currency: 'USD' },
      paymentMethod,
      destination: {
        address,
        network: DEFAULT_NETWORK,
        asset: DEFAULT_ASSET,
      },
      domain: getDomain(),
    }

    const jwt = await generateJwt({
      apiKeyId,
      apiKeySecret,
      requestMethod: 'POST',
      requestHost: CDP_HOST,
      requestPath: CDP_ORDER_PATH,
      expiresIn: 120,
    })

    const orderRes = await fetch(CDP_BASE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderBody),
    })

    if (!orderRes.ok) {
      const errText = await orderRes.text()
      console.error('Coinbase onramp order error', orderRes.status, errText)
      return Response.json({ error: 'Failed to create onramp order' }, { status: 502 })
    }

    const data = (await orderRes.json()) as OnrampOrderResponse
    if (!data.paymentLink || typeof data.paymentLink !== 'string') {
      return Response.json({ error: 'Invalid onramp order response' }, { status: 502 })
    }

    let paymentLink = data.paymentLink
    const paymentUrl = new URL(paymentLink)
    if (redirectUrl) {
      paymentUrl.searchParams.set('redirectUrl', redirectUrl)
    }
    paymentLink = paymentUrl.toString()

    return Response.json({
      paymentLink,
      orderId: data.orderId ?? null,
      origin: PAY_ORIGIN,
    })
  } catch (e) {
    console.error('Onramp order error', e)
    return Response.json({ error: 'Failed to generate onramp order' }, { status: 500 })
  }
}
