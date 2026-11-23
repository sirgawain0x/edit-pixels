/**
 * 16-bit mono WAV encoding for cloud transcription sub-files.
 *
 * Why WAV rather than Opus: the model accepts `audio/wav` up to 2 GB, and PCM in a RIFF
 * wrapper needs no encoder, no container muxer and no browser codec support, so the
 * sub-file bytes are produced identically in every browser and in tests. 16 kHz mono is
 * 32 KB/s — a 20-minute part is ~38 MB, which is a few seconds on a normal connection and
 * costs nothing on the provider side, because billing is per token of audio, not per byte.
 * Swapping in Opus later is a bandwidth optimisation, not a correctness fix.
 *
 * The audio is already mono at 16 kHz by the time it gets here (see `resampler.ts`).
 */

const HEADER_BYTES = 44
const BITS_PER_SAMPLE = 16
const CHANNELS = 1

function clampToInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value))
  // 32767, not 32768: +1.0 must not wrap to the most negative sample.
  return Math.round(clamped * 32767)
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index++) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}

/** RIFF/WAVE header plus 16-bit little-endian mono samples. */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  // Backed by an explicit ArrayBuffer so the result is accepted as a `BlobPart`; a plain
  // `Uint8Array` widens to `ArrayBufferLike`, which `Blob` rejects.
  const bytes = new Uint8Array(new ArrayBuffer(HEADER_BYTES + samples.length * 2))
  const view = new DataView(bytes.buffer)
  const dataBytes = samples.length * 2
  const byteRate = sampleRate * CHANNELS * (BITS_PER_SAMPLE / 8)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')

  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk size
  view.setUint16(20, 1, true) // format 1 = PCM
  view.setUint16(22, CHANNELS, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, CHANNELS * (BITS_PER_SAMPLE / 8), true) // block align
  view.setUint16(34, BITS_PER_SAMPLE, true)

  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let index = 0; index < samples.length; index++) {
    view.setInt16(HEADER_BYTES + index * 2, clampToInt16(samples[index] ?? 0), true)
  }

  return bytes
}

/** Slice `[startSec, endSec)` out of 16 kHz mono PCM, clamped to what actually exists. */
export function sliceSeconds(
  samples: Float32Array,
  sampleRate: number,
  startSec: number,
  endSec: number,
): Float32Array {
  const start = Math.max(0, Math.min(samples.length, Math.round(startSec * sampleRate)))
  const end = Math.max(start, Math.min(samples.length, Math.round(endSec * sampleRate)))
  return samples.slice(start, end)
}
