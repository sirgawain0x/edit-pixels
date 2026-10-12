/**
 * Alchemy ERC-4337 smart account identity for Pixels (must match `wallet_requestAccount` on the client).
 *
 * `PIXELS_SMART_ACCOUNT_ID` is Alchemy's persisted account record UUID for `wallet_requestAccount` — not the CREATE2 salt.
 */
export const PIXELS_SMART_ACCOUNT_ID = 'e1459502-d074-4044-81e1-e7b2744a60b0'

export const PIXELS_SMART_ACCOUNT_TYPE = 'sma-b' as const

/**
 * CREATE2 salt for Alchemy SMA (`createSemiModularAccount(owner, salt)`).
 * Confirmed by decoding `counterfactualInfo.factoryData` from `wallet_requestAccount`
 * with `includeCounterfactualInfo: true` (salt decodes to `0n` for sma-b).
 * Re-verify: `node scripts/confirm-pixels-smart-account-salt.mjs` when `ALCHEMY_API_KEY` is set.
 */
export const PIXELS_SMART_ACCOUNT_SALT = 0n
