import { isLiveStyleSpendAuthSoftBypass } from './live-style-production-guard'

export function isLiveStyleSpendAuthEnforcedFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isLiveStyleSpendAuthSoftBypass(env)) return false
  const flag = env.LIVE_STYLE_ENABLED ?? env.VITE_ENABLE_LIVE_STYLE
  const enabled = flag === '1' || flag === 'true'
  if (!enabled) return false
  return Boolean(env.LIVE_STYLE_PAYMENT_SPENDER?.trim())
}
