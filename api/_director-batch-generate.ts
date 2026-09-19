/**
 * Resolve batch-confirm payment for per-shot generate calls.
 */
// fallow-ignore-file unused-export

import { bindBatchConfirmShot } from './_pixels-generate-billing-core.js'
import {
  findBatchConfirmShot,
  getDirectorBatchConfirm,
  getDirectorBatchQuote,
  markDirectorBatchShotStarted,
} from './_director-batch-store.js'

export type BatchGenerateAuthResult =
  | {
      ok: true
      paymentTxHash: string | null
      skipPaymentVerify: boolean
    }
  | { ok: false; error: string }

export async function resolveBatchGeneratePayment(input: {
  batchConfirmId: string
  shotId: string
  requestId: string
  wallet: string
}): Promise<BatchGenerateAuthResult> {
  const batchConfirmId = input.batchConfirmId.trim()
  const confirm = await getDirectorBatchConfirm(batchConfirmId)
  if (!confirm) {
    return { ok: false, error: 'batch_confirm_mismatch' }
  }

  const binding = bindBatchConfirmShot(
    {
      batchConfirmId: confirm.batchConfirmId,
      wallet: confirm.wallet,
      paymentTxHash: confirm.paymentTxHash,
      shots: confirm.shots,
    },
    input.shotId,
    input.requestId,
    input.wallet,
  )
  if (!binding.ok) {
    return { ok: false, error: binding.error }
  }

  const shot = findBatchConfirmShot(confirm, input.shotId, input.requestId)
  if (!shot) {
    return { ok: false, error: 'batch_confirm_mismatch' }
  }

  await markDirectorBatchShotStarted(batchConfirmId, shot.shotId)

  return {
    ok: true,
    paymentTxHash: binding.paymentTxHash,
    skipPaymentVerify: true,
  }
}

export async function getBatchShotGenerateParams(input: {
  batchConfirmId: string
  shotId: string
}): Promise<
  | {
      ok: true
      prompt: string
      aspect_ratio: string
      resolution: '480p' | '720p'
      veoDuration: number
      seedanceDuration: number
      seedanceQuoteId: string
      provider: 'veo' | 'seedance'
    }
  | { ok: false }
> {
  const confirm = await getDirectorBatchConfirm(input.batchConfirmId.trim())
  if (!confirm) return { ok: false }

  const shotConfirm = confirm.shots.find((shot) => shot.shotId === input.shotId.trim())
  if (!shotConfirm) return { ok: false }

  const quote = await getDirectorBatchQuote(confirm.batchQuoteId)
  if (!quote) return { ok: false }

  const shotQuote = quote.shots.find((shot) => shot.shotId === input.shotId.trim())
  if (!shotQuote) return { ok: false }

  return {
    ok: true,
    prompt: shotQuote.prompt,
    aspect_ratio: shotQuote.aspect_ratio,
    resolution: shotQuote.resolution,
    veoDuration: shotQuote.veoDuration,
    seedanceDuration: shotQuote.seedanceDuration,
    seedanceQuoteId: shotQuote.seedanceQuoteId,
    provider: shotConfirm.provider,
  }
}
