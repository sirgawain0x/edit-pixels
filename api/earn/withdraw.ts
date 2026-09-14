/**
 * POST /api/earn/withdraw — withdraw from the configured Earn vault to the user's Privy embedded wallet.
 * Body: { amount?: string, max?: boolean }
 * Prefer `max: true` to withdraw full `assets_in_vault`, or pass a human-readable `amount`.
 */
// fallow-ignore-file complexity,duplicate-export
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

  const payload =
    typeof body === 'object' && body !== null ? (body as { amount?: unknown; max?: unknown }) : null
  const max = payload?.max === true
  const amount = payload ? parsePositiveDecimalAmount(payload.amount) : null

  if (!max && !amount) {
    return Response.json(
      { error: 'Provide amount (positive decimal) or max: true' },
      { status: 400 },
    )
  }

  const client = getPrivyNodeClient()
  if (!client) {
    return Response.json({ error: 'earn not configured' }, { status: 503 })
  }

  const vaultId = getEarnVaultId()

  try {
    let withdrawParams: {
      vault_id: string
      amount?: string
      raw_amount?: string
      authorization_context: { user_jwts: string[] }
    }

    if (max) {
      const position = await client
        .wallets()
        .earn()
        .ethereum()
        .vaultPosition(session.walletId, { vault_id: vaultId })
      if (!position.assets_in_vault || position.assets_in_vault === '0') {
        return Response.json({ error: 'nothing to withdraw' }, { status: 400 })
      }
      withdrawParams = {
        vault_id: vaultId,
        raw_amount: position.assets_in_vault,
        authorization_context: {
          user_jwts: [session.accessToken],
        },
      }
    } else {
      withdrawParams = {
        vault_id: vaultId,
        amount: amount!,
        authorization_context: {
          user_jwts: [session.accessToken],
        },
      }
    }

    const action = await client
      .wallets()
      .earn()
      .ethereum()
      .withdraw(session.walletId, withdrawParams)
    return Response.json(toEarnActionPublic(action))
  } catch (error) {
    console.error('earn withdraw error', error)
    const message = error instanceof Error ? error.message : 'withdraw failed'
    return Response.json({ error: message }, { status: 502 })
  }
}
