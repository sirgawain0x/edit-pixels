import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'
import {
  CRTVAI_DIAMOND_ADDRESS,
  METOKEN_DIAMOND_ABI,
} from './metoken-config.mjs'

/**
 * CRTVAI on-chain bridge for Pixels MCP billing.
 *
 * Reads balances, current price, and mint quotes from the CRTVAI meToken
 * diamond on Base. Provides a helper to verify that a specific transfer to
 * the platform treasury was actually mined.
 *
 * This module is intended to run on the server side (headless/MCP renderer),
 * so it uses a plain Viem public client over HTTPS rather than React hooks.
 */

/**
 * Build a Base public client using an Alchemy key.
 * Falls back to a public RPC if no key is provided (slower, rate-limited).
 *
 * @param {string} [alchemyKey]
 */
function createBaseClient(alchemyKey) {
  const url = alchemyKey
    ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`
    : 'https://mainnet.base.org'
  return createPublicClient({
    chain: base,
    transport: http(url),
  })
}

/**
 * Read the current meToken price (raw uint256).
 *
 * @param {string} [alchemyKey]
 */
export async function readCrtvaiCurrentPrice(alchemyKey) {
  const client = createBaseClient(alchemyKey)
  return client.readContract({
    address: CRTVAI_DIAMOND_ADDRESS,
    abi: METOKEN_DIAMOND_ABI,
    functionName: 'getCurrentPrice',
  })
}

/**
 * Verify that a CRTVAI transfer transaction moved tokens from a user to the
 * platform treasury. Used to credit on-chain deposits without needing an
 * indexer.
 *
 * @param {object} options
 * @param {`0x${string}`} options.txHash
 * @param {`0x${string}`} options.from - expected sender (user wallet)
 * @param {`0x${string}`} options.to - expected recipient (platform treasury)
 * @param {string} [options.alchemyKey]
 * @returns {Promise<{ok: true, amountWei: bigint} | {ok: false, reason: string}>}
 */
// fallow-ignore-next-line complexity
export async function verifyCrtvaiTransfer({ txHash, from, to, alchemyKey }) {
  const client = createBaseClient(alchemyKey)
  try {
    const receipt = await client.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') {
      return { ok: false, reason: 'Transaction failed' }
    }

    // We do not decode via Viem's event abstraction here; we match raw logs
    // manually so this module has no runtime ABI decoder dependency beyond
    // topic hashing (which we avoid by comparing the indexed topic payload).
    const logs = receipt.logs.filter(
      (log) =>
        log.address.toLowerCase() === CRTVAI_DIAMOND_ADDRESS.toLowerCase() &&
        log.topics[1]?.toLowerCase() ===
          `0x000000000000000000000000${from.slice(2)}`.toLowerCase() &&
        log.topics[2]?.toLowerCase() === `0x000000000000000000000000${to.slice(2)}`.toLowerCase(),
    )

    if (logs.length === 0) {
      return { ok: false, reason: 'No matching CRTVAI transfer found in receipt' }
    }

    // Sum all matching transfers (rare, but possible in complex txs).
    let amountWei = 0n
    for (const log of logs) {
      amountWei += BigInt(log.data)
    }

    if (amountWei === 0n) {
      return { ok: false, reason: 'Transfer amount is zero' }
    }

    return { ok: true, amountWei }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

