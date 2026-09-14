/**
 * GET /api/earn/vault — public vault metadata (APY, liquidity, asset) for the configured Earn vault.
 */
import {
  getEarnVaultId,
  getPrivyNodeClient,
  isEarnConfigured,
  toEarnVaultPublic,
} from '../_earn-privy.js'

export async function GET(): Promise<Response> {
  if (!isEarnConfigured()) {
    return Response.json({ error: 'earn not configured' }, { status: 503 })
  }

  const client = getPrivyNodeClient()
  if (!client) {
    return Response.json({ error: 'earn not configured' }, { status: 503 })
  }

  const vaultId = getEarnVaultId()

  try {
    const details = await client.wallets().earn().ethereum().vaultDetails(vaultId)
    return Response.json(toEarnVaultPublic(details))
  } catch (error) {
    console.error('earn vault details error', error)
    return Response.json({ error: 'failed to load vault' }, { status: 502 })
  }
}
