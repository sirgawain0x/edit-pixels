import { describe, expect, it } from 'vitest'
import { encodeWav16, sliceSeconds } from './wav-encode'

const SAMPLE_RATE = 16_000

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

describe('encodeWav16', () => {
  it('writes a RIFF/WAVE header the provider will accept', () => {
    const samples = new Float32Array(1000)
    const bytes = encodeWav16(samples, SAMPLE_RATE)
    const view = new DataView(bytes.buffer)

    expect(readAscii(bytes, 0, 4)).toBe('RIFF')
    expect(readAscii(bytes, 8, 4)).toBe('WAVE')
    expect(readAscii(bytes, 12, 4)).toBe('fmt ')
    expect(readAscii(bytes, 36, 4)).toBe('data')

    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE)
    expect(view.getUint32(28, true)).toBe(SAMPLE_RATE * 2) // byte rate
    expect(view.getUint16(32, true)).toBe(2) // block align
    expect(view.getUint16(34, true)).toBe(16) // bits per sample

    // Sizes must describe the whole file or players read a truncated stream.
    expect(view.getUint32(4, true)).toBe(bytes.length - 8)
    expect(view.getUint32(40, true)).toBe(samples.length * 2)
    expect(bytes.length).toBe(44 + samples.length * 2)
  })

  it('clamps instead of wrapping at full scale', () => {
    const bytes = encodeWav16(new Float32Array([1, -1, 2, -2]), SAMPLE_RATE)
    const view = new DataView(bytes.buffer)

    // +1.0 must be 32767, not -32768: the classic wrap that turns a peak into a click.
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32767)
    expect(view.getInt16(48, true)).toBe(32767)
    expect(view.getInt16(50, true)).toBe(-32767)
  })

  it('encodes a half-scale sine without clipping it', () => {
    const samples = new Float32Array(SAMPLE_RATE)
    for (let index = 0; index < samples.length; index++) {
      samples[index] = 0.5 * Math.sin((2 * Math.PI * 100 * index) / SAMPLE_RATE)
    }
    const view = new DataView(encodeWav16(samples, SAMPLE_RATE).buffer)

    let peak = 0
    for (let index = 0; index < samples.length; index++) {
      peak = Math.max(peak, Math.abs(view.getInt16(44 + index * 2, true)))
    }
    expect(peak).toBeGreaterThan(16_000)
    expect(peak).toBeLessThanOrEqual(16_384)
  })
})

describe('sliceSeconds', () => {
  it('slices by time and clamps to the audio that exists', () => {
    const samples = new Float32Array(SAMPLE_RATE * 2).map((_, index) => index)

    expect(sliceSeconds(samples, SAMPLE_RATE, 1, 2)).toHaveLength(SAMPLE_RATE)
    expect(sliceSeconds(samples, SAMPLE_RATE, 1, 2)[0]).toBe(SAMPLE_RATE)
    // Past the end: return what exists rather than allocating silence.
    expect(sliceSeconds(samples, SAMPLE_RATE, 1.5, 10)).toHaveLength(SAMPLE_RATE / 2)
    // Inverted range collapses to empty instead of producing a negative length.
    expect(sliceSeconds(samples, SAMPLE_RATE, 2, 1)).toHaveLength(0)
  })
})
