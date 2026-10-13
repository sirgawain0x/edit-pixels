/// <reference types="node" />
// fallow-ignore-file complexity,unused-export
/**
 * Server-side CRTVAI meToken helpers.
 *
 * Reads CRTVAI balance and current price from the meToken diamond on Base,
 * and verifies on-chain debits (sell transactions) for AI render payments.
 *
 * Unlike the old Redis credit store, debiting is on-chain: the user's smart
 * wallet calls sell() or the treasury pulls meTokens, and the server verifies
 * the transaction rather than maintaining an off-chain ledger.
 */

import { createPublicClient, http, parseAbi, type Hex } from 'viem'
import { base } from 'viem/chains'
import { readMeTokensMintedForDeposit } from './_metoken-curve-quote.js'

const CRTVAI_DIAMOND_ADDRESS = '0xecb695544a3d2a64d579b3828f3f60f6932f4846' as const

const METOKEN_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
])

function getBaseRpcUrl(): string {
  const apiKey = process.env.ALCHEMY_API_KEY as string | undefined
  if (apiKey) return `https://base-mainnet.g.alchemy.com/v2/${apiKey}`
  return 'https://mainnet.base.org'
}

function getClient() {
  return createPublicClient({
    chain: base,
    transport: http(getBaseRpcUrl()),
  })
}

export interface MetokenBalanceResult {
  balance: string
  formatted: string
  price: string
}

/**
 * Read CRTVAI meToken balance for a wallet address on Base.
 */
export async function getMetokenBalance(address: string): Promise<MetokenBalanceResult> {
  const client = getClient()
  const balance = await client.readContract({
    address: CRTVAI_DIAMOND_ADDRESS,
    abi: METOKEN_ABI,
    functionName: 'balanceOf',
    args: [address as Hex],
  })

  const balanceStr = balance.toString()
  const formatted = (Number(balance) / 1e18).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })

  const oneUsdcMinted = await readMeTokensMintedForDeposit(1_000_000n)
  const price =
    oneUsdcMinted > 0n ? ((1_000_000n * 10n ** 18n) / oneUsdcMinted).toString() : '0'

  return { balance: balanceStr, formatted, price }
}

/**
 * Check if an address has sufficient CRTVAI balance for a render.
 * The cost is quoted in USDC-equivalent (6 decimals); we convert to
 * meToken wei using the current meToken price.
 */
export async function checkMetokenSufficient(
  address: string,
  costUsdc6: number,
): Promise<{ sufficient: boolean; balance: bigint; requiredMetoken: bigint }> {
  const client = getClient()
  const balance = await client.readContract({
    address: CRTVAI_DIAMOND_ADDRESS,
    abi: METOKEN_ABI,
    functionName: 'balanceOf',
    args: [address as Hex],
  })

  const requiredMetoken = await readMeTokensMintedForDeposit(BigInt(costUsdc6))

  return {
    sufficient: requiredMetoken > 0n && balance >= requiredMetoken,
    balance,
    requiredMetoken,
  }
}

/**
 * Verify that a Transfer event occurred from the user's address to the
 * treasury address, with at least the required meToken amount.
 * Used as proof-of-payment for AI renders.
 */
export async function verifyMetokenDebit(
  txHash: string,
  fromAddress: string,
  treasuryAddress: string,
  minAmount: bigint,
): Promise<{ verified: boolean; amount: bigint }> {
  const client = getClient()
  try {
    const receipt = await client.getTransactionReceipt({
      hash: txHash as Hex,
    })
    if (receipt.status !== 'success') return { verified: false, amount: 0n }

    const fromLower = fromAddress.toLowerCase()
    const toLower = treasuryAddress.toLowerCase()

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== CRTVAI_DIAMOND_ADDRESS.toLowerCase()) continue
      if (log.topics.length < 3) continue
      // Transfer(from, to, value) — topics[1]=from, topics[2]=to
      // EVM topics are 32-byte padded; extract the last 20 bytes (40 hex chars) for address comparison
      const fromTopic = log.topics[1]
      const toTopic = log.topics[2]
      if (!fromTopic || !toTopic) continue

      const parsedFrom = `0x${fromTopic.slice(-40)}`.toLowerCase()
      const parsedTo = `0x${toTopic.slice(-40)}`.toLowerCase()
      if (parsedFrom !== fromLower || parsedTo !== toLower) continue

      const value = log.data ? BigInt(log.data) : 0n
      if (value >= minAmount) {
        return { verified: true, amount: value }
      }
    }
    return { verified: false, amount: 0n }
  } catch {
    return { verified: false, amount: 0n }
  }
}

/** CRTVAI diamond address for server-side use. */
export { CRTVAI_DIAMOND_ADDRESS }
