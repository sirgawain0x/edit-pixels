/** Default Privy auth API host (also used when `VITE_VERCEL_ENV` is not production). */
export const PRIVY_DEFAULT_AUTH_API_URL = 'https://auth.privy.io'

/** Production HttpOnly-cookie custom auth domain for Pixels. */
export const PRIVY_PRODUCTION_CUSTOM_API_URL = 'https://privy.create.creativeplatform.xyz'

/**
 * Privy `apiUrl` for {@link PrivyProvider}.
 *
 * Production Vercel builds use the custom auth domain; preview, development, and
 * missing `VITE_VERCEL_ENV` omit `apiUrl` so the SDK defaults to `auth.privy.io`.
 */
export function resolvePrivyApiUrl(): string | undefined {
  const vercelEnv = import.meta.env.VITE_VERCEL_ENV
  if (vercelEnv === 'production') {
    return PRIVY_PRODUCTION_CUSTOM_API_URL
  }
  return undefined
}
