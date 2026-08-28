import { parseAbi } from 'viem'

/**
 * CreditPackSettlement — the fixed-price credit-pack contract on Base.
 *
 * Single-tx curve-aware buy + burn + credit mint. The user pays a FIXED USDC
 * price (no curve slippage at checkout); the treasury absorbs the curve risk
 * and the 20% refundRatio burn donation.
 *
 * `settlePack(buyer, packId, maxSlippageBps)` is `nonpayable` — it pulls USDC
 * from the buyer via `safeTransferFrom`, so the buyer must approve USDC to the
 * settlement contract first. `maxSlippageBps` is a fixed internal default
 * (50 bps), NOT user-facing.
 */

/** Deployed CreditPackSettlement contract on Base. */
export const CREDIT_PACK_SETTLEMENT_ADDRESS = '0x03e8a588CD5873796b5C5EF6A96e7EE7704d1FF9' as const

/** Fixed internal slippage guard (bps). Invisible to the user by design. */
export const CREDIT_PACK_MAX_SLIPPAGE_BPS = 50n

export const CREDIT_PACK_SETTLEMENT_ABI = parseAbi([
  'function settlePack(address buyer, uint256 packId, uint256 maxSlippageBps) returns (uint256 meTokensBurned)',
  'function packPrice(uint256 packId) view returns (uint256 fiatAmount)',
  'function packCredits(uint256 packId) view returns (uint256 credits)',
  'function setPack(uint256 packId, uint256 fiatAmount, uint256 credits)',
  'function sweep(address recipient)',
  'function owner() view returns (address)',
  'event PackSettled(address indexed buyer, uint256 packId, uint256 fiatAmount, uint256 assetDeposited, uint256 meTokensMinted, uint256 meTokensBurned, uint256 assetRefunded, uint256 creditsMinted)',
])

export interface CreditPackDefinition {
  /** On-chain packId (must match the `setPack` registration). */
  id: number
  name: string
  /** USDC amount with 6 decimals (e.g. 20_000_000 = $20). */
  usdc6: number
  credits: number
  description: string
}

/**
 * The three retail packs. IDs 0/1/2 must match the `setPack` calldata @boo
 * registers on-chain. $0.10/credit: $20→200, $50→500, $100→1000.
 */
export const SETTLEMENT_CREDIT_PACKS: readonly CreditPackDefinition[] = [
  {
    id: 0,
    name: 'Starter',
    usdc6: 20_000_000,
    credits: 200,
    description: '200 credits',
  },
  {
    id: 1,
    name: 'Pro',
    usdc6: 50_000_000,
    credits: 500,
    description: '500 credits',
  },
  {
    id: 2,
    name: 'Studio',
    usdc6: 100_000_000,
    credits: 1000,
    description: '1000 credits',
  },
] as const
