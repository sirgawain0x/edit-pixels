/**
 * Shared meToken curve quote constants (server).
 */

/** Default quote lifetime before expiry (seconds). */
export const METOKEN_QUOTE_EXPIRY_SECONDS = 75

/** Slippage band vs quoted CRTVAI amount at settlement (basis points). */
export const METOKEN_QUOTE_SLIPPAGE_BPS = 250

/** meTokens Diamond on Base (FoundryFacet entrypoint). */
export const METOKENS_DIAMOND_ADDRESS = '0xba5502db2aC2cBff189965e991C07109B14eB3f5' as const

/** CRTVAI meToken (ERC-20) on Base. */
export const CRTVAI_METOKEN_ADDRESS = '0xecb695544a3d2a64d579b3828f3f60f6932f4846' as const
