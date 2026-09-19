/**
 * Batch confirm for Director storyboard → Pixels Generate enqueue.
 * Verifies payment once; per-shot generates reference batchConfirmId.
 */
// fallow-ignore-file complexity

import { checkMetokenSufficient } from './_metoken-server.js'
import { bindDirectorBatchSelections } from './_director-batch-quote-core.js'
import {
  getDirectorBatchQuote,
  saveDirectorBatchConfirm,
  type DirectorBatchConfirmRecord,
} from './_director-batch-store.js'
import type { PixelsRenderProvider } from './_director-generate-map.js'
import { isSeedanceBillingEnforced } from './_seedance-billing.js'
import { isFlowBillingEnforced, verifyFlowPayment } from './flow-billing.js'

export interface DirectorBatchConfirmSelection {
  shotId: string
  provider: PixelsRenderProvider
  requestId: string
}

export interface DirectorBatchConfirmJob {
  shotId: string
  requestId: string
  provider: PixelsRenderProvider
  status: 'queued'
  seedanceQuoteId: string | null
  crtvaiRequired: string
  pollUrl: string
  generateEndpoint: '/api/seedance-generate' | '/api/pixels-render-veo'
}

export interface DirectorBatchConfirmResult {
  batchConfirmId: string
  batchQuoteId: string
  paymentTxHash: string | null
  totalCrtvaiRequired: string
  totalCrtvaiDisplay: number
  jobs: DirectorBatchConfirmJob[]
}

export async function confirmDirectorStoryboardBatch(input: {
  wallet: string
  batchQuoteId: string
  selections: DirectorBatchConfirmSelection[]
  paymentTxHash?: string | null
}): Promise<
  | { ok: true; confirm: DirectorBatchConfirmResult }
  | { ok: false; error: string; status?: number }
> {
  const batchQuoteId = input.batchQuoteId.trim()
  const quote = await getDirectorBatchQuote(batchQuoteId)
  if (!quote) {
    return { ok: false, error: 'quote_not_found', status: 400 }
  }

  const binding = bindDirectorBatchSelections(
    quote,
    input.wallet,
    input.selections.map((selection) => ({
      shotId: selection.shotId,
      provider: selection.provider,
    })),
  )
  if (!binding.ok) {
    return { ok: false, error: binding.error, status: 400 }
  }

  const requestIds = new Set<string>()
  for (const selection of input.selections) {
    const rid = selection.requestId.trim()
    if (!rid || requestIds.has(rid)) {
      return { ok: false, error: 'duplicate_request_id', status: 400 }
    }
    requestIds.add(rid)
  }

  const billingEnforced = isSeedanceBillingEnforced() || isFlowBillingEnforced()
  let paymentTxHash: string | null = null

  if (billingEnforced) {
    const tx = input.paymentTxHash?.trim() ?? ''
    if (!tx) {
      return { ok: false, error: 'payment_required', status: 402 }
    }
    const verified = await verifyFlowPayment({
      txHash: tx,
      from: input.wallet,
      minAmountWei: binding.totalCrtvaiWei,
      purpose: 'pixels-director-batch',
    })
    if (!verified.ok) {
      return { ok: false, error: verified.reason, status: 402 }
    }
    paymentTxHash = tx
  } else {
    const totalUsdc6 = input.selections.reduce((sum, selection) => {
      const shot = quote.shots.find((entry) => entry.shotId === selection.shotId.trim())
      if (!shot) return sum
      return (
        sum +
        (selection.provider === 'veo' ? shot.veoUsdc6 : shot.seedanceUsdc6)
      )
    }, 0)
    try {
      const balanceCheck = await checkMetokenSufficient(input.wallet, totalUsdc6)
      if (!balanceCheck.sufficient) {
        return {
          ok: false,
          error: 'insufficient_crtvai',
          status: 402,
        }
      }
    } catch (e) {
      console.warn('director batch confirm balance check skipped', e)
    }
  }

  const confirmRecord = await saveDirectorBatchConfirm({
    batchQuoteId,
    wallet: input.wallet.trim().toLowerCase(),
    paymentTxHash,
    totalCrtvaiWei: binding.totalCrtvaiWei.toString(),
    shots: input.selections.map((selection) => ({
      shotId: selection.shotId.trim(),
      provider: selection.provider,
      requestId: selection.requestId.trim(),
      started: false,
    })),
  })

  const jobs = buildConfirmJobs(quote, confirmRecord, input.selections)
  return {
    ok: true,
    confirm: {
      batchConfirmId: confirmRecord.batchConfirmId,
      batchQuoteId,
      paymentTxHash,
      totalCrtvaiRequired: binding.totalCrtvaiWei.toString(),
      totalCrtvaiDisplay: Number(binding.totalCrtvaiWei) / 1e18,
      jobs,
    },
  }
}

function buildConfirmJobs(
  quote: { shots: Array<{
    shotId: string
    seedanceQuoteId: string
    veoCrtvaiWei: string
    seedanceCrtvaiWei: string
  }> },
  confirm: DirectorBatchConfirmRecord,
  selections: DirectorBatchConfirmSelection[],
): DirectorBatchConfirmJob[] {
  const shotById = new Map(quote.shots.map((shot) => [shot.shotId, shot]))

  return selections.map((selection) => {
    const shot = shotById.get(selection.shotId.trim())
    const provider = selection.provider
    const crtvaiRequired =
      provider === 'veo' ? shot?.veoCrtvaiWei ?? '0' : shot?.seedanceCrtvaiWei ?? '0'
    const requestId = selection.requestId.trim()

    return {
      shotId: selection.shotId.trim(),
      requestId,
      provider,
      status: 'queued',
      seedanceQuoteId: provider === 'seedance' ? shot?.seedanceQuoteId ?? null : null,
      crtvaiRequired,
      pollUrl: `/api/pixels-generate-task?id=${encodeURIComponent(requestId)}`,
      generateEndpoint:
        provider === 'seedance' ? '/api/seedance-generate' : '/api/pixels-render-veo',
    }
  })
}
