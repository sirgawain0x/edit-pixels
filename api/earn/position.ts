/**
 * GET /api/earn/position — caller's Earn vault position (requires Privy Bearer token).
 */
// fallow-ignore-file complexity,duplicate-export
import {
  getEarnVaultId,
  getPrivyNodeClient,
  isEarnConfigured,
  resolveEarnSession,
  toEarnPositionPublic,
} from '../_earn-privy.js'

export async function GET(request: Request): Promise<Response> {
  if (!isEarnConfigured()) {
    return Response.json({ error: 'earn not configured' }, { status: 503 })
  }

  const session = await resolveEarnSession(request)
  if (!session) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 })
  }

  const client = getPrivyNodeClient()
  if (!client) {
    return Response.json({ error: 'earn not configured' }, { status: 503 })
  }

  const vaultId = getEarnVaultId()

  try {
    const position = await client
      .wallets()
      .earn()
      .ethereum()
      .vaultPosition(session.walletId, { vault_id: vaultId })
    return Response.json(toEarnPositionPublic(position))
  } catch (error) {
    console.error('earn position error', error)
    return Response.json({ error: 'failed to load position' }, { status: 502 })
  }
}
