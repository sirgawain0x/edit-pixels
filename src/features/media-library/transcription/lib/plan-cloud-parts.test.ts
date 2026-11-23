import { describe, expect, it, vi } from 'vitest'
import { planCloudParts, type PlanCloudPartsProgress } from './plan-cloud-parts'
import type { PlannerRequest, PlannerResponse } from '../workers/transcription-planner.worker'

/** Minimal stand-in for a module worker: records what it was sent, drives what it sends back. */
class FakeWorker {
  onmessage: ((event: MessageEvent<PlannerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  sent: PlannerRequest[] = []
  terminated = false

  postMessage(message: PlannerRequest): void {
    this.sent.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  emit(message: PlannerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<PlannerResponse>)
  }
}

function file(): File {
  return new File([new Uint8Array(16)], 'meeting.webm', { type: 'audio/webm' })
}

function part(index: number, name = `part-${index}.wav`) {
  return {
    index,
    startSec: index * 1200,
    endSec: (index + 1) * 1200,
    overlapSec: 0.3,
    forcedCut: false,
    name,
    sizeBytes: 32,
  }
}

describe('planCloudParts', () => {
  it('sends the file, collects parts, and resolves on the final plan', async () => {
    const worker = new FakeWorker()
    const promise = planCloudParts(file(), { createWorker: () => worker as unknown as Worker })

    expect(worker.sent).toEqual([{ type: 'plan', file: expect.any(File) }])

    worker.emit({
      type: 'part',
      part: part(0),
      blob: new Blob([new Uint8Array([1, 2])], { type: 'audio/wav' }),
    })
    worker.emit({
      type: 'plan',
      result: { sourceDurationSec: 1200, submittedSeconds: 1200, parts: [part(0)] },
    })

    const result = await promise
    expect(result.parts).toHaveLength(1)
    expect(result.parts[0]).toMatchObject({
      name: 'part-0.wav',
      contentType: 'audio/wav',
      index: 0,
      startSec: 0,
      endSec: 1200,
      sizeBytes: 32,
    })
    expect(result.sourceDurationSec).toBe(1200)
    expect(worker.terminated).toBe(true)
  })

  it('forwards progress events with their stage', async () => {
    const worker = new FakeWorker()
    const onProgress = vi.fn<(event: PlanCloudPartsProgress) => void>()
    const promise = planCloudParts(file(), {
      createWorker: () => worker as unknown as Worker,
      onProgress,
    })

    worker.emit({ type: 'progress', stage: 'analyzing', progress: 0.5 })
    worker.emit({ type: 'progress', stage: 'encoding', progress: 1 })
    worker.emit({
      type: 'plan',
      result: { sourceDurationSec: 10, submittedSeconds: 10, parts: [] },
    })
    await promise

    expect(onProgress.mock.calls.map((call) => call[0])).toEqual([
      { stage: 'analyzing', progress: 0.5 },
      { stage: 'encoding', progress: 1 },
    ])
  })

  it('sorts parts by index even if the worker emits them out of order', async () => {
    const worker = new FakeWorker()
    const promise = planCloudParts(file(), { createWorker: () => worker as unknown as Worker })

    worker.emit({ type: 'part', part: part(1), blob: new Blob([new Uint8Array(1)]) })
    worker.emit({ type: 'part', part: part(0), blob: new Blob([new Uint8Array(1)]) })
    worker.emit({
      type: 'plan',
      result: { sourceDurationSec: 2400, submittedSeconds: 2400, parts: [part(0), part(1)] },
    })

    const result = await promise
    expect(result.parts.map((entry) => entry.index)).toEqual([0, 1])
  })

  it('rejects when the planner reports an error, and stops the worker', async () => {
    const worker = new FakeWorker()
    const promise = planCloudParts(file(), { createWorker: () => worker as unknown as Worker })

    worker.emit({ type: 'error', message: 'WebCodecs AudioDecoder is not available' })

    await expect(promise).rejects.toThrow(/AudioDecoder is not available/)
    expect(worker.terminated).toBe(true)
  })

  it('rejects when the plan is missing parts it announced', async () => {
    const worker = new FakeWorker()
    const promise = planCloudParts(file(), { createWorker: () => worker as unknown as Worker })

    // One part delivered, two announced: submitting would report files_missing.
    worker.emit({ type: 'part', part: part(0), blob: new Blob([new Uint8Array(1)]) })
    worker.emit({
      type: 'plan',
      result: { sourceDurationSec: 2400, submittedSeconds: 2400, parts: [part(0), part(1)] },
    })

    await expect(promise).rejects.toThrow(/announced 2 parts but delivered 1/)
  })

  it('rejects immediately when already aborted, without starting work', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    controller.abort()

    await expect(
      planCloudParts(file(), {
        createWorker: () => worker as unknown as Worker,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/)
    expect(worker.sent).toHaveLength(0)
    expect(worker.terminated).toBe(true)
  })

  it('stops the worker when aborted mid-plan', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const promise = planCloudParts(file(), {
      createWorker: () => worker as unknown as Worker,
      signal: controller.signal,
    })

    controller.abort()

    await expect(promise).rejects.toThrow(/aborted/)
    expect(worker.terminated).toBe(true)
  })

  it('passes a maxPartSeconds override through to the planner', async () => {
    const worker = new FakeWorker()
    const promise = planCloudParts(file(), {
      createWorker: () => worker as unknown as Worker,
      maxPartSeconds: 60,
    })
    worker.emit({
      type: 'plan',
      result: { sourceDurationSec: 10, submittedSeconds: 10, parts: [] },
    })
    await promise

    expect(worker.sent[0]).toMatchObject({ type: 'plan', maxPartSeconds: 60 })
  })
})
