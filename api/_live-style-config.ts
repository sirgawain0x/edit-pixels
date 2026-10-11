/**
 * Live Style server config — gated off by default.
 */

import {
  LIVE_STYLE_CAP_PRESETS_USD,
  type LiveStyleCapPresetUsd,
  type LiveStyleProviderId,
  LIVE_STYLE_PROVIDER_IDS,
} from '../src/features/live-style/lib/config.ts'

export {
  LIVE_STYLE_CAP_PRESETS_USD,
  LIVE_STYLE_PROVIDER_IDS,
  type LiveStyleCapPresetUsd,
  type LiveStyleProviderId,
}

export function isLiveStyleEnabled(): boolean {
  const flag = process.env.LIVE_STYLE_ENABLED ?? process.env.VITE_ENABLE_LIVE_STYLE
  return flag === '1' || flag === 'true'
}

export function getLiveStyleProviderUrl(): string | undefined {
  return process.env.LIVE_STYLE_PROVIDER_URL?.trim() || undefined
}

export function getLiveStyleProviderKey(): string | undefined {
  return process.env.LIVE_STYLE_PROVIDER_KEY?.trim() || undefined
}

/** Treasury / pull spender — placeholder until G2 configures on-chain pull. */
export function getLiveStylePaymentSpender(): string | undefined {
  return process.env.LIVE_STYLE_PAYMENT_SPENDER?.trim() || undefined
}

export function parseCapPresetUsd(value: unknown): LiveStyleCapPresetUsd | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (n === 1 || n === 3 || n === 6) return n
  return null
}

export function parseProviderId(value: unknown): LiveStyleProviderId {
  if (typeof value === 'string' && (LIVE_STYLE_PROVIDER_IDS as readonly string[]).includes(value)) {
    return value as LiveStyleProviderId
  }
  return 'mock'
}
