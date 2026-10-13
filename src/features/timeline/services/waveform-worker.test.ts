// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

type WorkerPostedMessage = { type: string; [key: string]: unknown }

const SAMPLE_RATE = 48_000
const DURATION_SEC = 3
const SAMPLES_PER_SECOND = 500
const BIN_DURATION_SEC = 0.02

function createMockSample(
  timestampSec: number,
  durationSec: number,
  options: { failCopy?: boolean } = {},
) {
  const frameCount = Math.max(1, Math.round(durationSec * SAMPLE_RATE))
  return {
    numberOfFrames: frameCount,
    numberOfChannels: 1,
    sampleRate: SAMPLE_RATE,
    timestamp: timestampSec,
    duration: durationSec,
    copyTo(dest: Float32Array) {
      if (options.failCopy) {
        throw new Error('Simulated packet decode failure')
      }
      dest.fill(0.75)
    },
    close: vi.fn(),
  }
}

const sampleFixture = vi.hoisted(() => ({
  mode: 'partial' as 'partial' | 'all-fail',
}))

async function* mockAudioSamples() {
  if (sampleFixture.mode === 'all-fail') {
    yield createMockSample(0, 1, { failCopy: true })
    yield createMockSample(1, 1, { failCopy: true })
    return
  }
  yield createMockSample(0, 1)
  yield createMockSample(1, 1, { failCopy: true })
  yield createMockSample(2, 1)
}

vi.mock('mediabunny', () => ({
  Input: class MockInput {
    dispose = vi.fn()
    async getPrimaryAudioTrack() {
      return {
        codec: 'mp3',
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 1,
        computeDuration: async () => DURATION_SEC,
      }
    }
  },
  AudioSampleSink: class MockAudioSampleSink {
    samples() {
      return mockAudioSamples()
    }
  },
  ALL_FORMATS: [],
}))

vi.mock('@/infrastructure/browser/mediabunny-input-source', () => ({
  createMediabunnyInputSource: vi.fn(() => ({})),
}))

vi.mock('@/shared/utils/ac3-decoder', () => ({
  ensureAc3DecoderRegistered: vi.fn(),
  isAc3AudioCodec: vi.fn(() => false),
}))

describe('waveform-worker', () => {
  const posted: WorkerPostedMessage[] = []
  let onmessage: ((event: MessageEvent) => void) | null = null

  beforeEach(async () => {
    sampleFixture.mode = 'partial'
    posted.length = 0
    onmessage = null
    vi.stubGlobal('self', {
      postMessage: vi.fn((message: WorkerPostedMessage, _options?: { transfer?: ArrayBuffer[] }) => {
        posted.push(message)
      }),
      onmessage: null as ((event: MessageEvent) => void) | null,
    })
    vi.resetModules()
    await import('./waveform-worker')
    onmessage = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('continues after a bad packet, emits later chunks and tail, and marks partial', async () => {
    expect(onmessage).toBeTypeOf('function')

    const requestId = 'waveform-partial-test'
    await onmessage!({
      data: {
        type: 'generate',
        requestId,
        blobUrl: 'blob:test',
        samplesPerSecond: SAMPLES_PER_SECOND,
        binDurationSec: BIN_DURATION_SEC,
      },
    } as MessageEvent)

    await vi.waitFor(() => posted.some((message) => message.type === 'complete'), {
      timeout: 5000,
    })

    const errorMessage = posted.find((message) => message.type === 'error')
    expect(errorMessage).toBeUndefined()

    const chunks = posted.filter((message) => message.type === 'chunk')
    expect(chunks.length).toBeGreaterThan(1)

    const lastChunk = chunks[chunks.length - 1]!
    const initMessage = posted.find((message) => message.type === 'init')
    expect(initMessage).toBeDefined()
    const init = initMessage as unknown as { totalSamples: number }
    expect(lastChunk.startIndex).toBeLessThan(init.totalSamples)
    expect((lastChunk.startIndex as number) + (lastChunk.peaks as Float32Array).length).toBe(
      init.totalSamples,
    )

    const mergedPeaks = new Float32Array(init.totalSamples)
    for (const chunk of chunks) {
      mergedPeaks.set(chunk.peaks as Float32Array, chunk.startIndex as number)
    }
    expect(mergedPeaks[SAMPLES_PER_SECOND * 2]).toBeGreaterThan(0)

    const complete = posted.find((message) => message.type === 'complete')
    expect(complete?.partial).toBe(true)
    expect(posted.some((message) => message.type === 'error')).toBe(false)
  })

  it('posts an error when no packets decode successfully', async () => {
    sampleFixture.mode = 'all-fail'

    await onmessage!({
      data: {
        type: 'generate',
        requestId: 'waveform-zero-decode',
        blobUrl: 'blob:test',
        samplesPerSecond: SAMPLES_PER_SECOND,
        binDurationSec: BIN_DURATION_SEC,
      },
    } as MessageEvent)

    await vi.waitFor(() => posted.some((message) => message.type === 'error'), {
      timeout: 5000,
    })

    expect(posted.some((message) => message.type === 'complete')).toBe(false)
    const errorMessage = posted.find((message) => message.type === 'error')
    expect(errorMessage?.error).toBe('No audio samples decoded')
  })
})
