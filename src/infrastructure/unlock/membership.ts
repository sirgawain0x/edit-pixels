import { parseAbi } from 'viem'
import { getArbitrumPublicClient } from '@/config/arbitrum-client'
import { getBasePublicClient } from '@/config/base-client'

const UNLOCK_HAS_VALID_KEY_ABI = parseAbi(['function getHasValidKey(address) view returns (bool)'])

const UNLOCK_KEY_EXPIRATION_ABI = parseAbi([
  'function keyExpirationTimestampFor(address keyOwner) view returns (uint256)',
])

/**
 * Unlock Protocol Lock contract addresses on Base (Creative Organization DAO).
 */
export const UNLOCK_LOCK_ADDRESSES_BASE = [
  '0x9c3744c96200a52d05a630d4aec0db707d7509be' as `0x${string}`, // Brand
  '0x13b818daf7016b302383737ba60c3a39fef231cf' as `0x${string}`, // Investor
  '0xf7c4cd399395d80f9d61fde833849106775269c6' as `0x${string}`, // Creator
]

/**
 * Pixels Premium Unlock lock on Arbitrum (paid $30/mo subscription).
 * Falls back to the deployed mainnet address when the env var is unset.
 */
const PIXELS_PREMIUM_LOCK_DEFAULT = '0xE91BD97247fdAd39B95221BC26795a4a4A01B332' as `0x${string}`

export function getPixelsPremiumLockAddress(): `0x${string}` | undefined {
  const v = import.meta.env.VITE_PIXELS_PREMIUM_LOCK_ADDRESS as string | undefined
  if (v && v.startsWith('0x')) return v as `0x${string}`
  return PIXELS_PREMIUM_LOCK_DEFAULT
}

/**
 * Returns true if the given address holds a valid key on any of the
 * Creative Organization DAO Unlock locks on Base.
 */
export async function checkPremiumMembership(address: `0x${string}`): Promise<boolean> {
  const client = getBasePublicClient()
  for (const lockAddress of UNLOCK_LOCK_ADDRESSES_BASE) {
    const hasKey = await client.readContract({
      address: lockAddress,
      abi: UNLOCK_HAS_VALID_KEY_ABI,
      functionName: 'getHasValidKey',
      args: [address],
    })
    if (hasKey) return true
  }
  return false
}

/**
 * Returns true if the given address holds a valid Pixels Premium key on Arbitrum.
 */
export async function checkPixelsPremium(address: `0x${string}`): Promise<boolean> {
  const lockAddress = getPixelsPremiumLockAddress()
  if (!lockAddress) return false
  const client = getArbitrumPublicClient()
  return client.readContract({
    address: lockAddress,
    abi: UNLOCK_HAS_VALID_KEY_ABI,
    functionName: 'getHasValidKey',
    args: [address],
  })
}

/**
 * Returns the UNIX seconds timestamp at which the address's Pixels Premium key
 * expires. Returns null if there is no key or the lock is not configured.
 * A value in the past means the key already expired.
 */
export async function getPixelsPremiumExpiry(address: `0x${string}`): Promise<number | null> {
  const lockAddress = getPixelsPremiumLockAddress()
  if (!lockAddress) return null
  const client = getArbitrumPublicClient()
  try {
    const ts = await client.readContract({
      address: lockAddress,
      abi: UNLOCK_KEY_EXPIRATION_ABI,
      functionName: 'keyExpirationTimestampFor',
      args: [address],
    })
    const seconds = Number(ts)
    if (!Number.isFinite(seconds) || seconds <= 0) return null
    return seconds
  } catch {
    return null
  }
}
