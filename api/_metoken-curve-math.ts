/**
 * Pure bonding-curve math for CRTVAI (hub 2, reserveWeight 50%, baseY 1e6).
 * Matches `calculateMeTokensMinted` on the Diamond for regression tests without RPC.
 */

const RW_PPM = 500_000n
const BASE_Y = 1_000_000n
const BASE_X = 10n ** 18n
const ONE_E18 = 10n ** 18n

export interface CurveState {
  /** CRTVAI total supply (wei, 18 decimals). */
  supplyWei: bigint
  /** balancePooled in USDC6. */
  balancePooledUsdc6: bigint
}

/** Tokens minted when depositing `assetsUsdc6` into the current pool. */
export function calculateMeTokensMintedPure(
  assetsUsdc6: bigint,
  state: CurveState,
): bigint {
  if (assetsUsdc6 <= 0n) return 0n
  const { supplyWei, balancePooledUsdc6 } = state

  if (supplyWei === 0n) {
    const rW = RW_PPM
    const numerator = assetsUsdc6 * powBigInt(BASE_X, 1_000_000n / rW)
    const denominator = (rW * BASE_Y) / 1_000_000n
    const inner = numerator / denominator
    return powBigIntApprox(inner, rW, 1_000_000n)
  }

  if (balancePooledUsdc6 <= 0n) return 0n
  const ratio = Number(assetsUsdc6) / Number(balancePooledUsdc6)
  const sqrtFactor = Math.sqrt(1 + ratio)
  const mintedFloat = (Number(supplyWei) / 1e18) * (sqrtFactor - 1)
  if (!Number.isFinite(mintedFloat) || mintedFloat <= 0) return 0n
  return BigInt(Math.floor(mintedFloat * 1e18))
}

function powBigInt(base: bigint, expRational: bigint): bigint {
  const exp = Number(expRational)
  if (exp === 2) return base * base
  const b = Number(base)
  const result = Math.pow(b, exp)
  return BigInt(Math.floor(result))
}

/** Integer-ish pow for rW=0.5: sqrt via float (test tolerance). */
function powBigIntApprox(inner: bigint, num: bigint, den: bigint): bigint {
  const value = Number(inner) / 1e18
  const exp = Number(num) / Number(den)
  const out = Math.pow(value, exp)
  return BigInt(Math.floor(out * 1e18))
}

function applySlippageUpperBound(quotedWei: bigint, slippageBps: number): bigint {
  return (quotedWei * BigInt(10_000 + slippageBps)) / 10_000n
}

export function isWithinSlippageBand(
  quotedWei: bigint,
  freshWei: bigint,
  slippageBps: number,
): boolean {
  if (quotedWei <= 0n) return freshWei <= 0n
  const upper = applySlippageUpperBound(quotedWei, slippageBps)
  return freshWei <= upper
}

export function settlementMinCrtvaiWei(quotedWei: bigint, freshWei: bigint): bigint {
  return quotedWei > freshWei ? quotedWei : freshWei
}
