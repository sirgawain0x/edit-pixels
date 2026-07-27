export const ALCHEMY_API_KEY = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined
export const ALCHEMY_POLICY_ID = import.meta.env.VITE_ALCHEMY_POLICY_ID as string | undefined
export const ALCHEMY_GAS_POLICY_TYPE = (import.meta.env.VITE_ALCHEMY_GAS_POLICY_TYPE ?? 'none') as
  | 'none'
  | 'usdc'
  | 'sponsored'
export const ALCHEMY_GAS_MAX_USDC6 = Number(import.meta.env.VITE_ALCHEMY_GAS_MAX_USDC6 ?? '1000000')
