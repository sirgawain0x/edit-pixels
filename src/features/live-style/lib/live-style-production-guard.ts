import { isRuntimeProduction } from './runtime-env'

export type LiveStyleProductionGuardFailure = {
  ok: false
  error: 'live_style_production_misconfigured'
  reason: string
}

export type LiveStyleProductionGuardResult =
  | { ok: true }
  | LiveStyleProductionGuardFailure

function isLiveStyleEnabledInEnv(env: NodeJS.ProcessEnv): boolean {
  const flag = env.LIVE_STYLE_ENABLED ?? env.VITE_ENABLE_LIVE_STYLE
  return flag === '1' || flag === 'true'
}

/** Refuse paid Live Style sessions in production when payment env is unsafe. */
export function checkLiveStyleProductionPaymentConfig(
  env: NodeJS.ProcessEnv = process.env,
): LiveStyleProductionGuardResult {
  if (!isRuntimeProduction(env)) return { ok: true }
  if (!isLiveStyleEnabledInEnv(env)) return { ok: true }

  if (env.LIVE_STYLE_SPEND_AUTH_SOFT === '1') {
    return {
      ok: false,
      error: 'live_style_production_misconfigured',
      reason: 'LIVE_STYLE_SPEND_AUTH_SOFT is not allowed when VERCEL_ENV or NODE_ENV is production',
    }
  }

  if (!env.LIVE_STYLE_PAYMENT_SPENDER?.trim()) {
    return {
      ok: false,
      error: 'live_style_production_misconfigured',
      reason: 'LIVE_STYLE_PAYMENT_SPENDER must be set when Live Style is enabled in production',
    }
  }

  return { ok: true }
}

/** Local dev only — ignored in production even if the env var is set. */
export function isLiveStyleSpendAuthSoftBypass(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isRuntimeProduction(env)) return false
  return env.LIVE_STYLE_SPEND_AUTH_SOFT === '1'
}
