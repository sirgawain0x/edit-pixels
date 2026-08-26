/**
 * Server-side Unlock premium checks for Director billing (mirrors client membership).
 */

import { createPublicClient, http, parseAbi } from 'viem'
import { arbitrum, base } from 'viem/chains'

const UNLOCK_HAS_VALID_KEY_ABI = parseAbi(['function getHasValidKey(address) view returns (bool)'])

const UNLOCK_LOCK_ADDRESSES_BASE = [
  '0x9c3744c96200a52d05a630d4aec0db707d7509be',
  '0x13b818daf7016b302383737ba60c3a39fef231cf',
  '0xf7c4cd399395d80f9d61fde833849106775269c6',
] as const

const PIXELS_PREMIUM_LOCK_DEFAULT = '0xE91BD97247fdAd39B95221BC26795a4a4A01B332'

function alchemyUrl(network: 'base' | 'arbitrum'): string {
  const key = process.env.ALCHEMY_API_KEY?.trim() || process.env.VITE_ALCHEMY_API_KEY?.trim() || ''
  if (!key) {
    return network === 'base' ? 'https://mainnet.base.org' : 'https://arb1.arbitrum.io/rpc'
  }
  return network === 'base'
    ? `https://base-mainnet.g.alchemy.com/v2/${key}`
    : `https://arb-mainnet.g.alchemy.com/v2/${key}`
}

function pixelsPremiumLock(): `0x${string}` {
  const v =
    process.env.PIXELS_PREMIUM_LOCK_ADDRESS?.trim() ||
    process.env.VITE_PIXELS_PREMIUM_LOCK_ADDRESS?.trim()
  if (v?.startsWith('0x') && v.length >= 42) return v as `0x${string}`
  return PIXELS_PREMIUM_LOCK_DEFAULT
}

async function hasValidKey(
  chain: 'base' | 'arbitrum',
  lock: `0x${string}`,
  address: `0x${string}`,
): Promise<boolean> {
  const client = createPublicClient({
    chain: chain === 'base' ? base : arbitrum,
    transport: http(alchemyUrl(chain)),
  })
  return client.readContract({
    address: lock,
    abi: UNLOCK_HAS_VALID_KEY_ABI,
    functionName: 'getHasValidKey',
    args: [address],
  })
}

/** True if wallet holds Creative Org DAO key (Base) or Pixels Premium (Arbitrum). */
export async function isPremiumWallet(address: string): Promise<boolean> {
  if (!address.startsWith('0x') || address.length < 42) return false
  const wallet = address.toLowerCase() as `0x${string}`

  try {
    for (const lock of UNLOCK_LOCK_ADDRESSES_BASE) {
      if (await hasValidKey('base', lock, wallet)) return true
    }
    if (await hasValidKey('arbitrum', pixelsPremiumLock(), wallet)) return true
  } catch (e) {
    console.error('premium membership check failed', e)
  }
  return false
}
