import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkLiveStyleProductionPaymentConfig,
  isLiveStyleSpendAuthSoftBypass,
} from './live-style-production-guard'
import { isLiveStyleSpendAuthEnforcedFromEnv } from './live-style-spend-auth-policy'

const baseProdEnv: NodeJS.ProcessEnv = {
  VERCEL_ENV: 'production',
  LIVE_STYLE_ENABLED: '1',
  LIVE_STYLE_PAYMENT_SPENDER: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
}

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...baseProdEnv, ...overrides }
}

describe('live style production payment guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects production when LIVE_STYLE_PAYMENT_SPENDER is missing', () => {
    const result = checkLiveStyleProductionPaymentConfig(
      env({ LIVE_STYLE_PAYMENT_SPENDER: undefined }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('live_style_production_misconfigured')
      expect(result.reason).toContain('LIVE_STYLE_PAYMENT_SPENDER')
    }
  })

  it('rejects production when LIVE_STYLE_SPEND_AUTH_SOFT is set', () => {
    const result = checkLiveStyleProductionPaymentConfig(
      env({ LIVE_STYLE_SPEND_AUTH_SOFT: '1' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('LIVE_STYLE_SPEND_AUTH_SOFT')
    }
  })

  it('allows production when spender is set and soft is off', () => {
    expect(checkLiveStyleProductionPaymentConfig(baseProdEnv)).toEqual({ ok: true })
  })

  it('allows non-production with soft bypass for local dev', () => {
    const local = {
      NODE_ENV: 'development',
      LIVE_STYLE_ENABLED: '1',
      LIVE_STYLE_SPEND_AUTH_SOFT: '1',
    } satisfies NodeJS.ProcessEnv
    expect(checkLiveStyleProductionPaymentConfig(local)).toEqual({ ok: true })
    expect(isLiveStyleSpendAuthSoftBypass(local)).toBe(true)
    expect(isLiveStyleSpendAuthEnforcedFromEnv(local)).toBe(false)
  })

  it('production with correct config enforces on-chain verification', () => {
    expect(isLiveStyleSpendAuthSoftBypass(baseProdEnv)).toBe(false)
    expect(isLiveStyleSpendAuthEnforcedFromEnv(baseProdEnv)).toBe(true)
  })

  it('ignores soft bypass in production even if env var is set', () => {
    const misconfigured = env({ LIVE_STYLE_SPEND_AUTH_SOFT: '1' })
    expect(isLiveStyleSpendAuthSoftBypass(misconfigured)).toBe(false)
    expect(isLiveStyleSpendAuthEnforcedFromEnv(misconfigured)).toBe(true)
  })
})
