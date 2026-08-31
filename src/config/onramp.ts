export const DEFAULT_ONRAMP_NETWORK = 'base'
export const DEFAULT_ONRAMP_ASSET = 'USDC'
export const DEFAULT_ONRAMP_PAYMENT_METHOD = 'GUEST_CHECKOUT_APPLE_PAY' as const

export const ONRAMP_PAYMENT_METHODS = {
  APPLE_PAY: 'GUEST_CHECKOUT_APPLE_PAY',
  GOOGLE_PAY: 'GUEST_CHECKOUT_GOOGLE_PAY',
} as const

export type OnrampPaymentMethod =
  (typeof ONRAMP_PAYMENT_METHODS)[keyof typeof ONRAMP_PAYMENT_METHODS]

export const PAY_COINBASE_ORIGIN = 'https://pay.coinbase.com'

/**
 * Coinbase Guest Checkout legal links (required acknowledgement before order create).
 */
export const ONRAMP_LEGAL_LINKS = {
  guestCheckoutTos: 'https://www.coinbase.com/legal/guest-checkout/us',
  userAgreement: 'https://www.coinbase.com/legal/user_agreement',
  privacyPolicy: 'https://www.coinbase.com/legal/privacy',
} as const

/**
 * When true, partnerUserRef is prefixed with sandbox- and payment links get
 * useApplePaySandbox / useGooglePaySandbox query params.
 */
export function isOnrampSandboxMode(): boolean {
  return import.meta.env.VITE_ONRAMP_SANDBOX === 'true'
}

/**
 * Coinbase-hosted onramp: base URL for the API that returns the one-click buy URL.
 * When empty, the frontend uses the same origin (e.g. /api/onramp-url on Vercel).
 */
function getOnrampApiBaseUrl(): string {
  return (import.meta.env.VITE_ONRAMP_API_URL as string | undefined) ?? ''
}

function withApiPath(localPath: string, remoteSuffix: string): string {
  const base = getOnrampApiBaseUrl().replace(/\/$/, '')
  return base ? `${base}/${remoteSuffix}` : localPath
}

export function getOnrampApiUrl(): string {
  return withApiPath('/api/onramp-url', 'onramp-url')
}

export function getOnrampVerifyApiUrl(): string {
  return withApiPath('/api/onramp-verify', 'onramp-verify')
}

export function getOnrampVerifySubmitApiUrl(): string {
  return withApiPath('/api/onramp-verify-submit', 'onramp-verify-submit')
}

export function buildSandboxPartnerUserRef(address: string): string {
  const short = address.slice(0, 42)
  return isOnrampSandboxMode() ? `sandbox-${short}` : short.slice(0, 50)
}
