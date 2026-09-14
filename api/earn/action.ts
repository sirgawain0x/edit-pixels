/**
 * GET /api/earn/action?id=... — poll Earn deposit/withdraw wallet action status.
 */
// fallow-ignore-file complexity,duplicate-export
import {
  getPrivyNodeClient,
  isEarnConfigured,
  resolveEarnSession,
  toEarnActionPublic,
} from '../_earn-privy.js'

export async function GET(request: Request): Promise<Response> {
  if (!isEarnConfigured()) {
    return Response.json({ error: 'earn not configured' }, { status: 503 })
  }

  const session = await resolveEarnSession(request)
  if (!session) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 })
  }

  const url = new URL(request.url)
  const actionId = url.searchParams.get('id')?.trim()
  if (!actionId) {
    return Response.json({ error: 'id required' }, { status: 400 })
  }

  const client = getPrivyNodeClient()
  if (!client) {
    return Response.json({ error: 'earn not configured' }, { status: 503 })
  }

  try {
    const action = await client.wallets().actions.get(actionId, {
      wallet_id: session.walletId,
    })

    if (action.wallet_id !== session.walletId) {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }

    if (action.type !== 'earn_deposit' && action.type !== 'earn_withdraw') {
      return Response.json({ error: 'not an earn deposit/withdraw action' }, { status: 400 })
    }

    return Response.json(toEarnActionPublic(action))
  } catch (error) {
    console.error('earn action poll error', error)
    return Response.json({ error: 'failed to load action' }, { status: 502 })
  }
}
