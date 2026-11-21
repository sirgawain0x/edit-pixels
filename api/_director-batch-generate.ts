/**
 * Resolve batch-confirm payment for per-shot generate calls.
 *
 * Claim timing: validate binding first; atomic SETNX claim only after quote/billing
 * pre-flight succeeds; release claim if provider enqueue fails (retry allowed).
 */
import { bindBatchConfirmShot } from './_pixels-generate-billing-core.js'
import {
  findBatchConfirmShot,
  getDirectorBatchConfirm,
  getDirectorBatchQuote,
  markDirectorBatchShotStarted,
  refreshDirectorBatchConfirmTtl,
  releaseDirectorBatchShotClaim,
  tryClaimDirectorBatchShot,
  type DirectorBatchShotQuoteRecord,
} from './_director-batch-store.js'
import type { PixelsRenderProvider } from './_director-generate-map.js'

export type BatchGenerateAuthResult =
  | {
      ok: true
      paymentTxHash: string | null
      skipPaymentVerify: boolean
    }
  | { ok: false; error: string }

export async function validateBatchGenerateAuthorization(input: {
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

  return {
    ok: true,
    paymentTxHash: binding.paymentTxHash,
    skipPaymentVerify: true,
  }
}

export async function claimBatchShotForGenerate(input: {
  batchConfirmId: string
  shotId: string
  requestId: string
}): Promise<{ ok: true } | { ok: false; error: 'batch_shot_already_started' }> {
  const claimed = await tryClaimDirectorBatchShot(input)
  if (!claimed.ok) return claimed
  await refreshDirectorBatchConfirmTtl(input.batchConfirmId)
  return { ok: true }
}

export async function completeBatchShotGenerate(input: {
  batchConfirmId: string
  shotId: string
}): Promise<void> {
  await markDirectorBatchShotStarted(input.batchConfirmId, input.shotId)
}

export { releaseDirectorBatchShotClaim }

export interface BatchShotGenerateParams {
  prompt: string
  aspect_ratio: string
  resolution: '480p' | '720p'
  omniDuration: number
  veoDuration: number
  seedanceDuration: number
  seedanceQuoteId: string
  provider: PixelsRenderProvider
}

// fallow-ignore-next-line complexity
async function loadBatchShotContext(batchConfirmId: string, shotId: string) {
  const confirm = await getDirectorBatchConfirm(batchConfirmId.trim())
  if (!confirm) return null

  const trimmedShotId = shotId.trim()
  const shotConfirm = confirm.shots.find((shot) => shot.shotId === trimmedShotId)
  if (!shotConfirm) return null

  // Preferred path: the confirm record snapshots the generate params at confirm
  // time, so enqueues survive the quote record's short TTL (and its deletion).
  if (shotConfirm.prompt) {
    const quote = await getDirectorBatchQuote(confirm.batchQuoteId).catch(() => null)
    const shotQuote = quote?.shots.find((shot) => shot.shotId === trimmedShotId)
    if (quote && shotQuote && quote.wallet === confirm.wallet) {
      return { shotConfirm, shotQuote }
    }
    return {
      shotConfirm,
      shotQuote: {
        shotId: trimmedShotId,
        prompt: shotConfirm.prompt ?? '',
        duration: shotConfirm.veoDuration ?? 0,
        omniDuration: shotConfirm.omniDuration ?? 0,
        veoDuration: shotConfirm.veoDuration ?? 0,
        seedanceDuration: shotConfirm.seedanceDuration ?? 0,
        aspect_ratio: shotConfirm.aspect_ratio ?? '16:9',
        resolution: shotConfirm.resolution ?? '720p',
        recommendedProvider: shotConfirm.provider,
        omniCrtvaiWei: '0',
        omniUsdc6: 0,
        veoCrtvaiWei: '0',
        veoUsdc6: 0,
        seedanceQuoteId: shotConfirm.seedanceQuoteId ?? '',
        seedanceCrtvaiWei: '0',
        seedanceUsdc6: 0,
      } as DirectorBatchShotQuoteRecord,
    }
  }

  const quote = await getDirectorBatchQuote(confirm.batchQuoteId)
  if (!quote) return null
  if (quote.wallet !== confirm.wallet) return null

  const shotQuote = quote.shots.find((shot) => shot.shotId === trimmedShotId)
  if (!shotQuote) return null

  return { shotConfirm, shotQuote }
}

export async function getBatchShotGenerateParams(input: {
  batchConfirmId: string
  shotId: string
}): Promise<{ ok: true; params: BatchShotGenerateParams } | { ok: false }> {
  const context = await loadBatchShotContext(input.batchConfirmId, input.shotId)
  if (!context) return { ok: false }

  const { shotConfirm, shotQuote } = context
  return {
    ok: true,
    params: {
      prompt: shotQuote.prompt,
      aspect_ratio: shotQuote.aspect_ratio,
      resolution: shotQuote.resolution,
      omniDuration: shotQuote.omniDuration,
      veoDuration: shotQuote.veoDuration,
      seedanceDuration: shotQuote.seedanceDuration,
      seedanceQuoteId: shotQuote.seedanceQuoteId,
      provider: shotConfirm.provider,
    },
  }
}
