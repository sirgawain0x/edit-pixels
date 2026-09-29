/**
 * CRTVAI payment release helpers for Creative Pixels generate jobs.
 */
// fallow-ignore-file complexity

import { releaseFlowPayment } from './flow-billing.js'
import {
  getPixelsGenerateJob,
  updatePixelsGenerateJob,
  type PixelsGenerateJob,
} from './_pixels-generate-jobs.js'

export interface PixelsGenerateJobError {
  code: string
  message: string
  type: string
}

/** Release a consumed treasury tx once (idempotent). */
export async function releasePixelsGenerateJobPayment(jobId: string): Promise<boolean> {
  const job = await getPixelsGenerateJob(jobId)
  if (!job?.paymentTxHash || job.paymentReleased) return false

  await releaseFlowPayment(job.paymentTxHash)
  await updatePixelsGenerateJob(jobId, { paymentReleased: true })
  return true
}

export async function failPixelsGenerateJob(
  jobId: string,
  error: PixelsGenerateJobError,
  options: { releasePayment?: boolean } = {},
): Promise<PixelsGenerateJob | null> {
  const releasePayment = options.releasePayment ?? true
  if (releasePayment) {
    await releasePixelsGenerateJobPayment(jobId)
  }
  return updatePixelsGenerateJob(jobId, {
    status: 'failed',
    progress: 0,
    error,
  })
}

export function canCancelPixelsGenerateJob(job: PixelsGenerateJob): boolean {
  return job.status === 'processing' && !job.output?.video_url
}

export async function cancelPixelsGenerateJob(jobId: string): Promise<PixelsGenerateJob | null> {
  await releasePixelsGenerateJobPayment(jobId)
  return updatePixelsGenerateJob(jobId, {
    status: 'cancelled',
    progress: 0,
    error: {
      code: 'user_cancelled',
      message: 'Generation cancelled',
      type: 'client',
    },
  })
}
