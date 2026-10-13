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
  /** Set to "true" to use sandbox- partnerUserRef and fake Apple/Google Pay sheets. */
  readonly VITE_ONRAMP_SANDBOX?: string
  /** Enable Creative Pixels Seedance generate tab (server must also enable). */
  readonly VITE_ENABLE_SEEDANCE_GENERATE?: string
  /** Enable paid Live Style (server LIVE_STYLE_ENABLED must also be on). */
  readonly VITE_ENABLE_LIVE_STYLE?: string
  /** Override Director batch Seedance (Higgsfield) concurrency (default 20). */
  readonly VITE_DIRECTOR_BATCH_SEEDANCE_CONCURRENCY?: string
  /** Alias for VITE_DIRECTOR_BATCH_SEEDANCE_CONCURRENCY. */
  readonly VITE_DIRECTOR_BATCH_CONCURRENCY?: string
  /** Vercel deploy environment exposed to the client (preview | production | development). */
  readonly VITE_VERCEL_ENV?: string
  /** QA-only: use OPFS workspace instead of showDirectoryPicker when non-production. */
  readonly VITE_QA_WORKSPACE_FALLBACK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
