/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SHOW_DEBUG_PANEL?: string
  readonly VITE_PRIVY_APP_ID?: string
  readonly VITE_PRIVY_CLIENT_ID?: string
  readonly VITE_ALCHEMY_API_KEY?: string
  readonly VITE_ALCHEMY_POLICY_ID?: string
  readonly VITE_ALCHEMY_GAS_POLICY_TYPE?: string
  readonly VITE_ALCHEMY_GAS_MAX_USDC6?: string
  readonly VITE_CRTVAIX_ADDRESS?: string
  readonly VITE_SUPERFLUID_RECEIVER?: string
  readonly VITE_PIXELS_PREMIUM_LOCK_ADDRESS?: string
  readonly VITE_ONRAMP_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
