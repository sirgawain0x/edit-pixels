/**
 * Turn a media file into uploadable cloud-transcription parts.
 *
 * This is the seam between "we have a recording" and "we have bytes in the job's GCS
 * prefix": it runs the planner worker, collects the encoded parts, and hands back
 * everything the upload and quote steps need. Nothing here talks to the network.
 *
 * The worker is injectable so this can be exercised without a browser — the message
 * contract is the part that breaks, and that is worth pinning down in a test.
 */
import type { PlannerRequest, PlannerResponse } from '../workers/transcription-planner.worker'

const WAV_CONTENT_TYPE = 'audio/wav'

export interface CloudPart {
  /** Leaf name inside the job prefix, e.g. `part-0.wav`. */
  name: string
  contentType: typeof WAV_CONTENT_TYPE
  blob: Blob
  index: number
  startSec: number
  endSec: number
  /** Seconds inside this part's span that the next part repeats. */
  overlapSec: number
  forcedCut: boolean
  sizeBytes: number
}

export interface PlanCloudPartsResult {
  sourceDurationSec: number
  /** Source seconds plus overlaps, which is what the provider bills. */
  submittedSeconds: number
  parts: CloudPart[]
}

export interface PlanCloudPartsProgress {
  stage: 'analyzing' | 'encoding'
  progress: number
}

export interface PlanCloudPartsOptions {
  onProgress?: (event: PlanCloudPartsProgress) => void
  /** Overridable for tests. */
  maxPartSeconds?: number
  createWorker?: () => Worker
  signal?: AbortSignal
}

function defaultWorker(): Worker {
  return new Worker(new URL('../workers/transcription-planner.worker.ts', import.meta.url), {
    type: 'module',
  })
}

/**
 * Plan and encode every part, then terminate the worker.
 *
 * A part arrives with its blob already encoded, so peak memory is the caller's array of
 * parts — at most a couple of dozen 38 MB WAVs for a full 480-minute run. Uploading each
 * part as it arrives would halve that; it is a deliberate deferral, recorded in the issue.
 */
export async function planCloudParts(
  file: File,
  options: PlanCloudPartsOptions = {},
): Promise<PlanCloudPartsResult> {
  const worker = (options.createWorker ?? defaultWorker)()

  return new Promise<PlanCloudPartsResult>((resolve, reject) => {
    const parts: CloudPart[] = []
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      if (error) reject(error)
    }

    const onAbort = (): void => {
      finish(new Error('transcription planning aborted'))
    }

    if (options.signal?.aborted) {
      onAbort()
      return
    }
    options.signal?.addEventListener('abort', onAbort)

    worker.onmessage = (event: MessageEvent<PlannerResponse>) => {
      const message = event.data

      if (message.type === 'progress') {
        options.onProgress?.({ stage: message.stage, progress: message.progress })
        return
      }

      if (message.type === 'error') {
        finish(new Error(message.message))
        return
      }

      if (message.type === 'part') {
        parts.push({
          name: message.part.name,
          contentType: WAV_CONTENT_TYPE,
          blob: message.blob,
          index: message.part.index,
          startSec: message.part.startSec,
          endSec: message.part.endSec,
          overlapSec: message.part.overlapSec,
          forcedCut: message.part.forcedCut,
          sizeBytes: message.part.sizeBytes,
        })
        return
      }

      // A finished plan with fewer parts than it announced cannot be uploaded: the submit
      // route checks every planned part and would report the missing ones as files_missing.
      if (parts.length !== message.result.parts.length) {
        finish(
          new Error(
            `planner announced ${message.result.parts.length} parts but delivered ${parts.length}`,
          ),
        )
        return
      }

      const result: PlanCloudPartsResult = {
        sourceDurationSec: message.result.sourceDurationSec,
        submittedSeconds: message.result.submittedSeconds,
        parts: parts.sort((left, right) => left.index - right.index),
      }
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      resolve(result)
    }

    worker.onerror = (event) => {
      finish(new Error(`transcription planner failed: ${event.message || 'unknown error'}`))
    }

    const request: PlannerRequest = {
      type: 'plan',
      file,
      ...(options.maxPartSeconds ? { maxPartSeconds: options.maxPartSeconds } : {}),
    }
    worker.postMessage(request)
  })
}
