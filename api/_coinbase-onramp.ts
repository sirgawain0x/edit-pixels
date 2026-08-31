/// <reference types="node" />
/**
 * Shared Coinbase CDP Headless Onramp helpers for Vercel serverless routes.
 * Uses Secret API Key ID + Secret (JWT) — not the Client API Key.
 */
// fallow-ignore-file unused-export,complexity

import { generateJwt } from '@coinbase/cdp-sdk/auth'

export const CDP_HOST = 'api.cdp.coinbase.com'
export const PAY_ORIGIN = 'https://pay.coinbase.com'
export const CDP_ORDER_PATH = '/platform/v2/onramp/orders'
export const CDP_VERIFICATIONS_PATH = '/platform/v2/onramp/verifications'

export const DEFAULT_ONRAMP_NETWORK = 'base'
export const DEFAULT_ONRAMP_ASSET = 'USDC'
export const DEFAULT_ONRAMP_PAYMENT_METHOD = 'GUEST_CHECKOUT_APPLE_PAY'
export const DEFAULT_ONRAMP_DOMAIN = 'create.creativeplatform.xyz'

const ALLOWED_PAYMENT_METHODS = new Set(['GUEST_CHECKOUT_APPLE_PAY', 'GUEST_CHECKOUT_GOOGLE_PAY'])

export function getCdpCredentials(): { apiKeyId: string; apiKeySecret: string } | null {
  // Accept either env var name: the CDP SDK itself falls back from
  // CDP_API_KEY_ID to CDP_API_KEY_NAME, and Vercel has the _NAME variant set.
  const apiKeyId =
    process.env.COINBASE_CDP_API_KEY_ID?.trim() || process.env.COINBASE_CDP_API_KEY_NAME?.trim()
  const apiKeySecret = process.env.COINBASE_CDP_API_KEY_SECRET?.trim()
  if (!apiKeyId || !apiKeySecret) return null
  return { apiKeyId, apiKeySecret }
}

export function missingCredentialsResponse(): Response {
  return Response.json(
    { error: 'Onramp not configured: missing CDP API credentials' },
    { status: 503 },
  )
}

export function getOnrampDomain(): string {
  const env = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL ?? ''
  if (!env) return DEFAULT_ONRAMP_DOMAIN
  try {
    return new URL(env.startsWith('http') ? env : `https://${env}`).hostname
  } catch {
    return env.replace(/^https?:\/\//, '').split('/')[0] || DEFAULT_ONRAMP_DOMAIN
  }
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (/^1\d{10}$/.test(digits)) return `+${digits}`
  if (/^\d{10}$/.test(digits)) return `+1${digits}`
  return null
}

export function normalizeAmount(value: string | null | undefined): string | null {
  if (!value) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n.toFixed(2)
}

export function isAllowedPaymentMethod(method: string): boolean {
  return ALLOWED_PAYMENT_METHODS.has(method)
}

export async function cdpFetch(
  method: 'GET' | 'POST',
  requestPath: string,
  body?: unknown,
): Promise<Response> {
  const credentials = getCdpCredentials()
  if (!credentials) {
    throw new Error('CDP credentials not configured')
  }

  const jwt = await generateJwt({
    apiKeyId: credentials.apiKeyId,
    apiKeySecret: credentials.apiKeySecret,
    requestMethod: method,
    requestHost: CDP_HOST,
    requestPath,
    expiresIn: 120,
  })

  return fetch(`https://${CDP_HOST}${requestPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

interface CdpErrorBody {
  errorType?: string
  errorMessage?: string
  error?: string
  message?: string
}

/** Parse Coinbase error body and return a Response that preserves useful detail. */
export function forwardCdpError(
  status: number,
  errText: string,
  fallbackMessage: string,
): Response {
  let parsed: CdpErrorBody | null = null
  try {
    parsed = JSON.parse(errText) as CdpErrorBody
  } catch {
    parsed = null
  }

  const errorType = parsed?.errorType
  const errorMessage =
    parsed?.errorMessage ?? parsed?.error ?? parsed?.message ?? (errText.trim() || fallbackMessage)

  const responseStatus = status >= 400 && status < 600 ? status : 502
  return Response.json(
    {
      error: errorMessage || fallbackMessage,
      errorType: errorType ?? null,
      errorMessage: errorMessage || fallbackMessage,
      upstreamStatus: status,
    },
    { status: responseStatus },
  )
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
