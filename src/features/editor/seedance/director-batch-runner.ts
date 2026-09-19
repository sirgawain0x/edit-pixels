import type { SignedRequestParams } from '@/features/editor/deps/generative'
import { buildDirectorPaymentOp } from '../director/build-director-payment'
import {
  confirmDirectorBatch,
  enqueueDirectorBatchShot,
  PixelsGenerateApiError,
  type DirectorBatchConfirmResponse,
  type DirectorBatchQuoteResponse,
} from './seedance-client'
import { resolveDirectorBatchConcurrency } from './director-batch-concurrency'
import {
  buildBatchSelections,
  countBatchProgress,
  isBatchQuoteExpired,
  resetFailedJobsForRetry,
  runWithConcurrency,
  totalCrtvaiForPath,
  type DirectorBatchPath,
  type DirectorBatchShotJob,
} from './director-batch-queue'
import {
  clearDirectorBatchJob,
  clearDirectorBatchPendingConfirm,
  loadDirectorBatchJob,
  loadDirectorBatchPendingConfirm,
  saveDirectorBatchJob,
  saveDirectorBatchPendingConfirm,
  updateDirectorBatchJobJobs,
  type DirectorBatchActiveJob,
} from './director-batch-job-store'
import { importRenderVideoToLibrary } from './import-render-to-library'
import { pollSeedanceTaskToVideo, pollVeoTaskToVideo, resolveVeoTaskId } from './pixels-generate-helpers'
import type { PixelsRenderProvider } from '@/config/pixels-render'

export type DirectorBatchRunnerPhase =
  | 'idle'
  | 'quoting'
  | 'confirming'
  | 'running'
  | 'done'

export interface DirectorBatchRunnerCallbacks {
  onPhase: (phase: DirectorBatchRunnerPhase) => void
  onJobs: (jobs: DirectorBatchShotJob[]) => void
  onError: (message: string) => void
}

async function confirmBatchPayment(
  canPayOnChain: boolean,
  crtvaiRequired: string,
  sendOps: (ops: ReturnType<typeof buildDirectorPaymentOp>[]) => Promise<{ txHash: string }>,
  refreshBalance: () => void,
): Promise<string | undefined> {
  if (!canPayOnChain) return undefined
  const { txHash } = await sendOps([buildDirectorPaymentOp(BigInt(crtvaiRequired))])
  refreshBalance()
  return txHash
}

function jobsFromConfirm(confirm: DirectorBatchConfirmResponse): DirectorBatchShotJob[] {
  return confirm.jobs.map((job) => ({
    shotId: job.shotId,
    requestId: job.requestId,
    provider: job.provider,
    status: 'queued',
    progress: 0,
    generateEndpoint: job.generateEndpoint,
  }))
}

async function pollBatchShotToVideo(
  auth: SignedRequestParams,
  job: DirectorBatchShotJob,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (job.provider === 'seedance') {
    return pollSeedanceTaskToVideo(auth, job.requestId, { signal, onProgress })
  }

  let veoTaskId = job.veoTaskId
  if (!veoTaskId) {
    const resolved = await resolveVeoTaskId(
      auth,
      {
        requestId: job.requestId,
        provider: 'veo',
        projectId: '',
        playheadFrame: 0,
        brief: { prompt: '', duration: 5, aspect_ratio: '16:9', framing: '' },
        resolution: '720p',
        veoTaskId: job.veoTaskId,
        startedAtMs: Date.now(),
      },
      signal,
    )
    if ('videoUrl' in resolved) return resolved.videoUrl
    veoTaskId = resolved.veoTaskId
  }

  return pollVeoTaskToVideo(auth, veoTaskId, { signal, onProgress })
}

// fallow-ignore-next-line complexity
async function runSingleBatchShot(
  auth: SignedRequestParams,
  batchConfirmId: string,
  job: DirectorBatchShotJob,
  projectId: string,
  signal: AbortSignal | undefined,
  onJobUpdate: (job: DirectorBatchShotJob) => void,
): Promise<void> {
  const running: DirectorBatchShotJob = { ...job, status: 'running', progress: 0 }
  onJobUpdate(running)

  try {
    let enqueue: Awaited<ReturnType<typeof enqueueDirectorBatchShot>> | null = null
    try {
      enqueue = await enqueueDirectorBatchShot(
        auth,
        job.generateEndpoint,
        {
          batchConfirmId,
          shotId: job.shotId,
          requestId: job.requestId,
        },
        signal,
      )
    } catch (error) {
      if (
        error instanceof PixelsGenerateApiError &&
        error.code === 'batch_shot_already_started'
      ) {
        enqueue = null
      } else {
        throw error
      }
    }

    if (enqueue?.status === 'completed' && enqueue.output?.video_url) {
      await importRenderVideoToLibrary(
        enqueue.output.video_url,
        projectId,
        job.provider,
        job.shotId,
      )
      onJobUpdate({ ...running, status: 'succeeded', progress: 100, videoUrl: enqueue.output.video_url })
      return
    }

    const veoTaskId = enqueue?.id
    const withTask = veoTaskId ? { ...running, veoTaskId } : running
    const videoUrl = await pollBatchShotToVideo(auth, withTask, (pct) => {
      onJobUpdate({ ...withTask, progress: pct })
    }, signal)

    await importRenderVideoToLibrary(videoUrl, projectId, job.provider, job.shotId)
    onJobUpdate({ ...withTask, status: 'succeeded', progress: 100, videoUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed'
    onJobUpdate({ ...job, status: 'failed', progress: 0, error: message })
  }
}

// fallow-ignore-next-line complexity
export async function confirmPaidDirectorBatch(input: {
  auth: SignedRequestParams
  quote: DirectorBatchQuoteResponse
  path: DirectorBatchPath
  storyboardId?: string
  perShotOverrides?: Readonly<Record<string, PixelsRenderProvider>>
  canPayOnChain: boolean
  sendOps: (ops: ReturnType<typeof buildDirectorPaymentOp>[]) => Promise<{ txHash: string }>
  refreshBalance: () => void
  callbacks: DirectorBatchRunnerCallbacks
}): Promise<DirectorBatchActiveJob | null> {
  const { auth, quote, path, callbacks } = input
  if (isBatchQuoteExpired(quote.expiresAt)) {
    throw new Error('Batch quote expired — refresh the quote before paying.')
  }

  const selections = buildBatchSelections(quote, path, input.perShotOverrides)
  const total = totalCrtvaiForPath(quote, path, input.perShotOverrides)

  const pending = loadDirectorBatchPendingConfirm()
  let paymentTxHash: string | undefined

  if (pending?.batchQuoteId === quote.batchQuoteId && pending.paymentTxHash) {
    paymentTxHash = pending.paymentTxHash
  } else {
    callbacks.onPhase('confirming')
    paymentTxHash = await confirmBatchPayment(
      input.canPayOnChain,
      total.crtvaiRequired,
      input.sendOps,
      input.refreshBalance,
    )
    saveDirectorBatchPendingConfirm({
      batchQuoteId: quote.batchQuoteId,
      paymentTxHash: paymentTxHash ?? null,
      selections,
    })
  }

  try {
    const confirm = await confirmDirectorBatch(auth, {
      batchQuoteId: quote.batchQuoteId,
      selections,
      ...(paymentTxHash ? { paymentTxHash } : {}),
    })

    clearDirectorBatchPendingConfirm()

    const jobs = jobsFromConfirm(confirm)
    callbacks.onJobs(jobs)

    const active: DirectorBatchActiveJob = {
      batchConfirmId: confirm.batchConfirmId,
      batchQuoteId: confirm.batchQuoteId,
      storyboardId: input.storyboardId,
      jobs,
      startedAtMs: Date.now(),
    }
    saveDirectorBatchJob(active)
    return active
  } catch (error) {
    if (error instanceof PixelsGenerateApiError && error.code === 'quote_already_confirmed') {
      const existing = loadDirectorBatchJob()
      if (existing?.batchQuoteId === quote.batchQuoteId) {
        clearDirectorBatchPendingConfirm()
        return existing
      }
    }
    throw error
  }
}

export async function runDirectorBatchQueue(input: {
  auth: SignedRequestParams
  active: DirectorBatchActiveJob
  projectId: string
  retryFailedOnly?: boolean
  callbacks: DirectorBatchRunnerCallbacks
  signal?: AbortSignal
}): Promise<DirectorBatchActiveJob> {
  const { auth, projectId, callbacks, signal } = input
  let jobs = input.retryFailedOnly
    ? resetFailedJobsForRetry(input.active.jobs)
    : input.active.jobs

  const active: DirectorBatchActiveJob = { ...input.active, jobs }
  saveDirectorBatchJob(active)
  callbacks.onJobs(jobs)
  callbacks.onPhase('running')

  const concurrency = resolveDirectorBatchConcurrency()
  const toRun = jobs.filter((job) => job.status === 'queued')

  const updateJob = (updated: DirectorBatchShotJob) => {
    jobs = jobs.map((job) => (job.shotId === updated.shotId ? updated : job))
    updateDirectorBatchJobJobs(jobs)
    callbacks.onJobs(jobs)
  }

  await runWithConcurrency(toRun, concurrency, async (job) => {
    await runSingleBatchShot(auth, active.batchConfirmId, job, projectId, signal, updateJob)
  })

  const progress = countBatchProgress(jobs)
  callbacks.onPhase(progress.failed > 0 && progress.succeeded < progress.total ? 'done' : 'done')
  const result = { ...active, jobs }
  saveDirectorBatchJob(result)

  if (progress.failed === 0) {
    clearDirectorBatchJob()
  }

  return result
}
