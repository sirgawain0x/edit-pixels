/** Wallet address validation — no viem or other heavy deps (safe for lightweight serverless routes). */

export const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
export const HEX_SIG_REGEX = /^0x[a-fA-F0-9]+$/;
export const MAX_SIG_AGE_MS = 5 * 60 * 1000;
