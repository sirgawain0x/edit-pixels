import { parseAbi } from 'viem'
import { base } from 'viem/chains'
import { getBasePublicClient } from '@/config/base-client'
import { ALCHEMY_API_KEY } from '@/config/alchemy'

/**
 * CRTVAI MeToken — Creative TV's AI payment token.
 *
 * Two distinct contracts are involved:
 *  - The **meToken** (`0xecb6…4846`) is a plain ERC-20 (MeToken.sol). Its
 *    `mint`/`burn` are `onlyDiamond`-gated, so users NEVER call them directly.
 *    Users only read `balanceOf` / `transfer` / `approve` on it.
 *  - The **Diamond** (`0xba55…3f5`) is the ERC-2535 proxy. Minting/burning go
 *    through its `FoundryFacet`:
 *      mint(address meToken, uint256 assetsDeposited, address recipient)
 *      burn(address meToken, uint256 meTokensBurned, address recipient)
 *    The FoundryFacet pulls the connector asset (USDC) from the caller via the
 *    hub vault's `handleDeposit` → `safeTransferFrom`, so the caller must
 *    approve USDC to the **vault**, not the Diamond and not the meToken.
 *
 * Hub 2 (USDC-backed): baseY=224, reserveWeight=32, refundRatio=80%.
 */

/** CRTVAI meToken (ERC-20) address on Base. */
export const CRTVAI_METOKEN_ADDRESS = '0xecb695544a3d2a64d579b3828f3f60f6932f4846' as const

/** meTokens Diamond (ERC-2535 proxy) address on Base. */
export const CRTVAI_DIAMOND_ADDRESS = '0xba5502db2aC2cBff189965e991C07109B14eB3f5' as const

/** Hub-2 vault — the USDC approval target for minting. */
export const CRTVAI_HUB_2_VAULT_ADDRESS = '0xd4b3f4d2c44Feba751F30e19D7e1047A29eE085d' as const

/** MeToken hub ID for CRTVAI (USDC-backed hub on Base). */
export const CRTVAI_HUB_ID = 2

/** USDC on Base mainnet (native USDC, 6 decimals). */
export const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const

/** USDC decimals (same across chains). */
export const USDC_DECIMALS = 6

/** CRTVAI meToken decimals (meTokens use 18). */
export const CRTVAI_DECIMALS = 18

/**
 * Wrapped Super Token address for CRTVAI on Base (CRTVAIx).
 * Set via env VITE_CRTVAIX_ADDRESS after deploying the Wrapped Super Token.
 * Required for Live AI streaming via Superfluid.
 */
export function getCrtvaiXAddress(): `0x${string}` | undefined {
  const v = import.meta.env.VITE_CRTVAIX_ADDRESS as string | undefined
  if (!v || !v.startsWith('0x')) return undefined
  return v as `0x${string}`
}

/** Treasury / receiver for Live AI streams on Base (env: VITE_SUPERFLUID_RECEIVER). */
export function getSuperfluidReceiverAddress(): `0x${string}` | undefined {
  const v = import.meta.env.VITE_SUPERFLUID_RECEIVER as string | undefined
  if (!v || !v.startsWith('0x')) return undefined
  return v as `0x${string}`
}

export function isSuperfluidConfigured(): boolean {
  return Boolean(getSuperfluidReceiverAddress() && getCrtvaiXAddress())
}

/** Chain ID for Superfluid streaming (Base). */
export const SUPERFLUID_CHAIN_ID = base.id

/** Seconds per billing interval (matches 5-minute interval pricing). */
export const BILLING_INTERVAL_SECONDS = 300

/** Minimum CRTVAI (in meToken wei, 18 decimals) required to start Live AI (one billing interval). */
export function minStartMetokenWei(intervalCostUsdc6: number): bigint {
  // Convert USDC6 cost to meToken wei using 12-decimal multiplier (18 - 6 = 12)
  return BigInt(intervalCostUsdc6) * 10n ** 12n
}

/** CRTVAI meToken wei (18 decimals) wrapped for one hour of streaming. */
export function wrapMetokenWeiForOneHour(intervalCostUsdc6: number): bigint {
  return BigInt(intervalCostUsdc6) * 10n ** 12n * 12n
}

/**
 * Superfluid flow rate (super-token wei per second, 18 decimals).
 * Derived from USDC6-equivalent per billing interval.
 */
export function intervalCostUsdc6ToFlowRate(intervalCostUsdc6: number): bigint {
  const numerator = BigInt(intervalCostUsdc6) * 10n ** 12n
  const interval = BigInt(BILLING_INTERVAL_SECONDS)
  return (numerator + interval - 1n) / interval
}

/** Convert USDC6 amount to meToken wei (18 decimals). */
export function usdc6ToMetokenWei(usdc6: bigint | number): bigint {
  return BigInt(usdc6) * 10n ** 12n
}

/** Hourly USDC-equivalent cost from interval pricing (for UI). */
export function hourlyUsdcFromInterval(intervalCostUsdc6: number): number {
  return (intervalCostUsdc6 * 12) / 1_000_000
}

// ── ABIs ────────────────────────────────────────────────────────────

/** ERC-20 facet — standard token interface on the meToken (balanceOf, transfer, etc.). */
export const METOKEN_ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

/**
 * FoundryFacet — the mint/burn entry point on the Diamond.
 * `mint`/`burn` take the meToken address and pull the connector asset through
 * the hub vault (approve USDC to the vault first).
 */
export const METOKEN_DIAMOND_ABI = parseAbi([
  'function mint(address meToken, uint256 assetsDeposited, address recipient) returns (uint256 meTokensMinted)',
  'function burn(address meToken, uint256 meTokensBurned, address recipient) returns (uint256 assetsReturned)',
  'function calculateMeTokensMinted(address meToken, uint256 assetsDeposited) view returns (uint256 meTokensMinted)',
  'function calculateAssetsReturned(address meToken, uint256 meTokensBurned, address sender) view returns (uint256 assetsReturned)',
])

/** CFAv1Forwarder — same address on all Superfluid networks. */
export const CFA_FORWARDER_ADDRESS = '0xcfA132E353cB4E398080B9700609bb008eceB125' as const

export const SUPER_TOKEN_ABI = parseAbi([
  'function upgrade(uint256 amount)',
  'function balanceOf(address account) view returns (uint256)',
])

// ── Read helpers ───────────────────────────────────────────────────

/** Read CRTVAI meToken balance for an address on Base. */
export async function readCrtvaiBalance(address: `0x${string}`): Promise<bigint> {
  const client = getBasePublicClient()
  return client.readContract({
    address: CRTVAI_METOKEN_ADDRESS,
    abi: METOKEN_ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  })
}

/** Read estimated meToken output for a given USDC input amount (FoundryFacet quote). */
export async function readCrtvaiMintQuote(usdcAmount: bigint): Promise<bigint> {
  const client = getBasePublicClient()
  return client.readContract({
    address: CRTVAI_DIAMOND_ADDRESS,
    abi: METOKEN_DIAMOND_ABI,
    functionName: 'calculateMeTokensMinted',
    args: [CRTVAI_METOKEN_ADDRESS, usdcAmount],
  })
}

/** Read estimated USDC return for selling a given meToken amount (FoundryFacet quote). */
export async function readCrtvaiSellQuote(
  metokenAmount: bigint,
  sender: `0x${string}`,
): Promise<bigint> {
  const client = getBasePublicClient()
  return client.readContract({
    address: CRTVAI_DIAMOND_ADDRESS,
    abi: METOKEN_DIAMOND_ABI,
    functionName: 'calculateAssetsReturned',
    args: [CRTVAI_METOKEN_ADDRESS, metokenAmount, sender],
  })
}

/**
 * Implied current price in USDC6 per whole CRTVAI, derived from a 1-USDC mint
 * quote. There is no `getCurrentPrice` view on the FoundryFacet; this is the
 * equivalent derived from `calculateMeTokensMinted`.
 */
export async function readCrtvaiCurrentPrice(): Promise<bigint> {
  const ONE_USDC = 1_000_000n
  const minted = await readCrtvaiMintQuote(ONE_USDC)
  if (minted === 0n) return 0n
  // price (USDC6 per whole token) = 1e6 * 1e18 / meTokensMinted
  return (ONE_USDC * 10n ** 18n) / minted
}

export function requireAlchemyKey(): string {
  if (!ALCHEMY_API_KEY) throw new Error('VITE_ALCHEMY_API_KEY is required')
  return ALCHEMY_API_KEY
}
