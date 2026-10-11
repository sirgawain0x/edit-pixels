/**
 * Live Style server config — gated off by default.
 */

import {
  type LiveStyleCapPresetUsd,
  type LiveStyleProviderId,
  LIVE_STYLE_PROVIDER_IDS,
} from '../src/features/live-style/lib/config.ts'

export function isLiveStyleEnabled(): boolean {
  const flag = process.env.LIVE_STYLE_ENABLED ?? process.env.VITE_ENABLE_LIVE_STYLE
  return flag === '1' || flag === 'true'
}

export function getLiveStyleProviderUrl(): string | undefined {
  return process.env.LIVE_STYLE_PROVIDER_URL?.trim() || undefined
}

/** Treasury / pull spender — placeholder until G2 configures on-chain pull. */
export function getLiveStylePaymentSpender(): string | undefined {
  return process.env.LIVE_STYLE_PAYMENT_SPENDER?.trim() || undefined
}

/** HMAC secret for short-lived Live Style WebSocket connect tokens (server-only). */
export function getLiveStyleWsTokenSecret(): string | undefined {
  return (
    process.env.LIVE_STYLE_WS_TOKEN_SECRET?.trim() ||
    process.env.LIVE_STYLE_PROVIDER_KEY?.trim() ||
    undefined
  )
}

export { parseCapPresetUsd } from '../src/features/live-style/lib/config.ts'

export function parseProviderId(value: unknown): LiveStyleProviderId {
  if (typeof value === 'string' && (LIVE_STYLE_PROVIDER_IDS as readonly string[]).includes(value)) {
    return value as LiveStyleProviderId
  }
  return 'mock'
}
