/**
 * POST /api/earn/deposit — deposit into the configured Earn vault from the user's Privy embedded wallet.
 * Body: { amount: string } (human-readable decimal, e.g. "1.5")
 *
 * Client must transfer USDC from the Alchemy smart account to the Privy EOA before calling this.
 */
import {
  getEarnVaultId,
  getPrivyNodeClient,
  isEarnConfigured,
  parsePositiveDecimalAmount,
  resolveEarnSession,
  toEarnActionPublic,
} from '../_earn-privy.js'

export async function POST(request: Request): Promise<Response> {
  if (!isEarnConfigured()) {
    return Response.json({ error: 'earn not configured' }, { status: 503 })
  }

  const session = await resolveEarnSession(request)
  if (!session) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Valid JSON body is required' }, { status: 400 })
  }

  const amount =
    typeof body === 'object' && body !== null
      ? parsePositiveDecimalAmount((body as { amount?: unknown }).amount)
      : null
  if (!amount) {
    return Response.json({ error: 'amount must be a positive decimal string' }, { status: 400 })
  }

  const client = getPrivyNodeClient()
  if (!client) {
    return Response.json({ error: 'earn not configured' }, { status: 503 })
  }

  const vaultId = getEarnVaultId()

  try {
    const action = await client
      .wallets()
      .earn()
      .ethereum()
      .deposit(session.walletId, {
        vault_id: vaultId,
        amount,
        authorization_context: {
          user_jwts: [session.accessToken],
        },
      })
    return Response.json(toEarnActionPublic(action))
  } catch (error) {
    console.error('earn deposit error', error)
    const message = error instanceof Error ? error.message : 'deposit failed'
    return Response.json({ error: message }, { status: 502 })
  }
}
