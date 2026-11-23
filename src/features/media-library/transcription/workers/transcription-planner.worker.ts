/**
 * Worker that turns a media file into cloud-transcription sub-files.
 *
 * Two passes over the decode, for one reason: memory. An eight-hour source is 1.8 GB of
 * 16 kHz Float32 PCM, so the first pass keeps only the energy profile (about 1 MB) to find
 * the pauses, and the second pass cuts the parts and releases each one as soon as its bytes
 * are encoded. Peak usage is one part (~120 MB for a 20-minute part) rather than the whole
 * recording.
 *
 * Parts come out as 16-bit mono WAV at 16 kHz — see `wav-encode.ts` for why PCM rather than
 * Opus. Decoding is mediabunny + WebCodecs, the same path `decoder.worker.ts` uses.
 *
 * The cut logic itself lives in `plan-subfiles.ts` and is unit-tested; this file only moves
 * bytes. `silenceWindows` measures loudness rather than running a neural VAD, which is
 * enough to find a pause between sentences and costs no model download.
 */
import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny'
import { downmixToMono, resampleTo16kHz } from '../lib/resampler'
import { FrameEnergyAccumulator, silenceWindows } from '../lib/silence-detect'
import { planSubFiles, totalSubmittedSeconds, type SubFilePlan } from '../lib/plan-subfiles'
import { encodeWav16 } from '../lib/wav-encode'

const SAMPLE_RATE = 16_000

export interface PlannedPart extends SubFilePlan {
  /** Leaf name inside the job prefix, e.g. `part-0.wav`. */
  name: string
  /** Encoded byte length, so the caller can size an upload without touching the blob. */
  sizeBytes: number
}

export interface PlannerRequest {
  type: 'plan'
  file: File
  /** Overridable for tests; defaults to the model's 20-minute cut. */
  maxPartSeconds?: number
}

export type PlannerResponse =
  | { type: 'progress'; stage: 'analyzing' | 'encoding'; progress: number }
  | { type: 'part'; part: PlannedPart; blob: Blob }
  | {
      type: 'plan'
      result: {
        sourceDurationSec: number
        /** Source seconds plus overlaps, which is what the provider bills. */
        submittedSeconds: number
        parts: PlannedPart[]
      }
    }
  | { type: 'error'; message: string }

function post(message: PlannerResponse): void {
  ;(self as unknown as Worker).postMessage(message)
}

/** Stream the file's audio as 16 kHz mono Float32, chunk by chunk. */
async function decodeMono16k(options: {
  file: File
  onSamples: (samples: Float32Array) => void
  onProgress?: (progress: number) => void
}): Promise<number> {
  if (typeof AudioDecoder === 'undefined') {
    throw new Error('WebCodecs AudioDecoder is not available in this browser')
  }

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(options.file) })
  try {
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack) throw new Error('No audio track found in file')

    const duration = await audioTrack.computeDuration()
    const decoderConfig = await audioTrack.getDecoderConfig()
    if (!decoderConfig) throw new Error('MediaBunny returned no decoder config for this file')

    const support = await AudioDecoder.isConfigSupported(decoderConfig)
    if (!support.supported) {
      throw new Error(`Audio codec is not supported by this browser (${decoderConfig.codec})`)
    }

    let decodeError: string | null = null
    const decoder = new AudioDecoder({
      output(audioData: AudioData) {
        try {
          const planeSize = audioData.allocationSize({ format: 'f32-planar', planeIndex: 0 })
          const plane0 = new Float32Array(planeSize / 4)
          audioData.copyTo(plane0, { format: 'f32-planar', planeIndex: 0 })

          const channels: Float32Array[] = [plane0]
          for (let channelIndex = 1; channelIndex < audioData.numberOfChannels; channelIndex++) {
            try {
              const size = audioData.allocationSize({
                format: 'f32-planar',
                planeIndex: channelIndex,
              })
              const plane = new Float32Array(size / 4)
              audioData.copyTo(plane, { format: 'f32-planar', planeIndex: channelIndex })
              channels.push(plane)
            } catch {
              break
            }
          }
          audioData.close()

          const mono = downmixToMono(channels)
          options.onSamples(resampleTo16kHz(mono, audioTrack.sampleRate))
        } catch (error) {
          decodeError = error instanceof Error ? error.message : String(error)
        }
      },
      error(error: DOMException) {
        decodeError = `AudioDecoder error: ${error.message}`
      },
    })

    decoder.configure(decoderConfig)
    let lastPct = -1
    const sink = new EncodedPacketSink(audioTrack)
    for await (const packet of sink.packets()) {
      if (decodeError) throw new Error(decodeError)

      // A long file decodes far faster than the consumer runs, so bound the queue.
      while (decoder.decodeQueueSize > 10) {
        await new Promise<void>((resolve) => {
          decoder.addEventListener('dequeue', () => resolve(), { once: true })
        })
      }

      decoder.decode(packet.toEncodedAudioChunk())

      if (duration > 0 && options.onProgress) {
        const fraction = Math.min(packet.timestamp / duration, 1)
        const pct = Math.floor(fraction * 100)
        if (pct > lastPct) {
          lastPct = pct
          options.onProgress(fraction)
        }
      }
    }

    await decoder.flush()
    decoder.close()
    if (decodeError) throw new Error(decodeError)
    return duration
  } finally {
    input.dispose()
  }
}

/** First pass: per-frame loudness only, so no audio is retained. */
async function analyzeSilence(
  file: File,
  durationHint: number,
): Promise<{
  energies: Float32Array
  frameSeconds: number
  durationSec: number
}> {
  const accumulator = new FrameEnergyAccumulator(SAMPLE_RATE)
  const duration = await decodeMono16k({
    file,
    onSamples: (samples) => accumulator.push(samples),
    onProgress: (progress) =>
      post({ type: 'progress', stage: 'analyzing', progress: Math.min(progress, 1) }),
  })

  const frames = accumulator.finish()
  const audioSeconds = frames.length * accumulator.frameWindowSeconds
  // Some containers report no duration; the frames are the audio we actually got.
  const durationSec = duration > 0 ? duration : Math.max(durationHint, audioSeconds)

  return { energies: frames, frameSeconds: accumulator.frameWindowSeconds, durationSec }
}

/**
 * Second pass: fill each part's buffer and release it as soon as it is complete.
 *
 * Parts are contiguous, so part i is finished before part i+1 ends — that is what lets this
 * hold one part at a time instead of the whole recording.
 */
async function cutParts(input: {
  file: File
  plans: readonly SubFilePlan[]
  onPart: (part: PlannedPart, blob: Blob) => void
}): Promise<void> {
  const buffers: Array<Float32Array | null> = input.plans.map(() => null)
  const emitted: boolean[] = input.plans.map(() => false)
  let decodedSamples = 0
  let nextToEmit = 0

  const emitReady = (): void => {
    while (nextToEmit < input.plans.length) {
      const plan = input.plans[nextToEmit]!
      const samples = buffers[nextToEmit]
      const endSample = Math.round(plan.endSec * SAMPLE_RATE)
      if (!samples || decodedSamples < endSample) return

      const wav = encodeWav16(samples, SAMPLE_RATE)
      input.onPart(
        { ...plan, name: `part-${plan.index}.wav`, sizeBytes: wav.byteLength },
        new Blob([wav], { type: 'audio/wav' }),
      )
      buffers[nextToEmit] = null
      emitted[nextToEmit] = true
      nextToEmit += 1
    }
  }

  await decodeMono16k({
    file: input.file,
    onSamples: (samples) => {
      const base = decodedSamples
      decodedSamples += samples.length

      input.plans.forEach((plan, index) => {
        if (emitted[index]) return
        const startSample = Math.round(plan.startSec * SAMPLE_RATE)
        const endSample = Math.round(plan.endSec * SAMPLE_RATE)
        const from = Math.max(base, startSample)
        const to = Math.min(base + samples.length, endSample)
        if (to <= from) return

        const buffer = buffers[index] ?? new Float32Array(endSample - startSample)
        buffers[index] = buffer
        buffer.set(samples.subarray(from - base, to - base), from - startSample)
      })

      emitReady()
    },
    onProgress: (progress) =>
      post({ type: 'progress', stage: 'encoding', progress: Math.min(progress, 1) }),
  })

  emitReady()
}

async function plan(file: File, maxPartSeconds?: number): Promise<void> {
  const analyzed = await analyzeSilence(file, 0)
  const windows = silenceWindows(analyzed.energies, analyzed.frameSeconds)
  const plans = planSubFiles({
    durationSec: analyzed.durationSec,
    silenceWindows: windows,
    ...(maxPartSeconds ? { maxPartSeconds } : {}),
  })

  const parts: PlannedPart[] = []
  await cutParts({
    file,
    plans,
    onPart: (part, blob) => {
      parts.push(part)
      post({ type: 'part', part, blob })
    },
  })

  post({
    type: 'plan',
    result: {
      sourceDurationSec: analyzed.durationSec,
      submittedSeconds: totalSubmittedSeconds(plans),
      parts,
    },
  })
}

self.onmessage = async (event: MessageEvent<PlannerRequest>) => {
  if (event.data.type !== 'plan') {
    post({ type: 'error', message: 'Unknown planner request type' })
    return
  }
  try {
    await plan(event.data.file, event.data.maxPartSeconds)
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
