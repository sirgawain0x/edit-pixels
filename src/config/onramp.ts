export const DEFAULT_ONRAMP_NETWORK = 'base'
export const DEFAULT_ONRAMP_ASSET = 'USDC'
export const DEFAULT_ONRAMP_PAYMENT_METHOD = 'GUEST_CHECKOUT_APPLE_PAY'

/**
 * Coinbase-hosted onramp: base URL for the API that returns the one-click buy URL.
 * When empty, the frontend uses the same origin (e.g. /api/onramp-url on Vercel).
 */
export function getOnrampApiBaseUrl(): string {
  return (import.meta.env.VITE_ONRAMP_API_URL as string | undefined) ?? ''
}

export function getOnrampApiUrl(): string {
  const base = getOnrampApiBaseUrl()
  return base ? `${base}/onramp-url` : '/api/onramp-url'
}
