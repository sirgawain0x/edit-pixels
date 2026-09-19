/**
 * POST /api/pixels-director-batch-confirm — bind batch quote + payment, enqueue generate jobs.
 */
// fallow-ignore-file complexity

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js'
import { isSeedanceGenerateEnabled } from './_seedance-pricing.js'
import { confirmDirectorStoryboardBatch } from './_director-batch-confirm-core.js'
import type { PixelsRenderProvider } from './_director-generate-map.js'

function parseSelections(raw: unknown): Array<{
  shotId: string
  provider: PixelsRenderProvider
  requestId: string
}> | null {
  if (!Array.isArray(raw)) return null
  const selections = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const row = item as Record<string, unknown>
    if (typeof row.shotId !== 'string' || typeof row.requestId !== 'string') return null
    const provider = row.provider === 'veo' || row.provider === 'seedance' ? row.provider : null
    if (!provider) return null
    selections.push({
      shotId: row.shotId,
      provider,
      requestId: row.requestId,
    })
  }
  return selections
}

export async function POST(request: Request): Promise<Response> {
  if (!isSeedanceGenerateEnabled()) {
    return Response.json({ error: 'feature_disabled' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return Response.json({ error: 'invalid body' }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const token = getBearerToken(request) || (typeof body.token === 'string' ? body.token : null)
  if (!token) {
    return Response.json({ error: 'missing authorization' }, { status: 401 })
  }

  const auth = await verifyPrivyAccessToken(
    token,
    typeof body.walletAddress === 'string' ? body.walletAddress : undefined,
  )
  if (!auth) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 })
  }

  const batchQuoteId =
    typeof body.batchQuoteId === 'string'
      ? body.batchQuoteId
      : typeof body.batch_quote_id === 'string'
        ? body.batch_quote_id
        : ''
  if (!batchQuoteId.trim()) {
    return Response.json({ error: 'batchQuoteId required' }, { status: 400 })
  }

  const selections = parseSelections(body.selections ?? body.shots)
  if (!selections || selections.length === 0) {
    return Response.json({ error: 'selections required' }, { status: 400 })
  }

  const result = await confirmDirectorStoryboardBatch({
    wallet: auth.address,
    batchQuoteId,
    selections,
    paymentTxHash:
      typeof body.paymentTxHash === 'string'
        ? body.paymentTxHash
        : typeof body.payment_tx_hash === 'string'
          ? body.payment_tx_hash
          : null,
  })

  if (!result.ok) {
    const status = result.status ?? 400
    if (result.error === 'insufficient_crtvai') {
      return Response.json({ error: result.error }, { status })
    }
    return Response.json({ error: result.error }, { status })
  }

  return Response.json({
    ...result.confirm,
    enqueue: {
      note:
        'Call generateEndpoint per job with batchConfirmId, shotId, requestId, and generate fields from the batch quote. Payment is already bound — do not send paymentTxHash on per-shot calls.',
      batchConfirmId: result.confirm.batchConfirmId,
    },
  })
}
