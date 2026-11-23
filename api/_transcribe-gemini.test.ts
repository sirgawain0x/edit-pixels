import { describe, expect, it, vi } from 'vitest'
import {
  buildTranscriptionConfig,
  parseTranscriptionResponse,
  secondsFromOffset,
  transcribeFile,
} from './_transcribe-gemini.js'

/**
 * Captured live from gemini-3.5-transcribe (Vertex, locations/global) with
 * mode VERBATIM + wordTimestamp + diarization + customVocabulary on a two-voice
 * clip. Trimmed to two words per turn; every field shape is exactly as returned.
 */
const twoSpeakerResponse = {
  candidates: [
    {
      content: {
        role: 'model',
        parts: [
          {
            text: 'Hi, this is the first speaker testing transcription.',
            audioTranscription: {
              text: 'Hi, this is the first speaker testing transcription.',
              speakerLabel: 'spk:0',
              words: [
                { word: 'Hi,', startOffset: '0.100s', endOffset: '0.600s' },
                { word: 'transcription.', startOffset: '2.200s', endOffset: '3.100s' },
              ],
            },
          },
          {
            text: 'And I am the second speaker. Numbers like $42 are useful.',
            audioTranscription: {
              text: 'And I am the second speaker. Numbers like $42 are useful.',
              speakerLabel: 'spk:1',
              words: [
                { word: 'And', startOffset: '3.200s', endOffset: '3.300s' },
                { word: 'useful.', startOffset: '6.900s', endOffset: '7.240s' },
              ],
            },
          },
        ],
      },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: {
    promptTokenCount: 226,
    candidatesTokenCount: 25,
    promptTokensDetails: [
      { modality: 'TEXT', tokenCount: 44 },
      { modality: 'AUDIO', tokenCount: 182 },
    ],
    candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 25 }],
  },
  modelVersion: 'gemini-3.5-transcribe',
}

describe('parseTranscriptionResponse', () => {
  it('keeps one segment per speaker turn, with labels', () => {
    const result = parseTranscriptionResponse(twoSpeakerResponse)
    expect(result.segments).toHaveLength(2)
    expect(result.segments.map((s) => s.speakerLabel)).toEqual(['spk:0', 'spk:1'])
  })

  it('turns duration strings into seconds', () => {
    const [first] = parseTranscriptionResponse(twoSpeakerResponse).segments
    expect(first.words).toEqual([
      { word: 'Hi,', startSeconds: 0.1, endSeconds: 0.6 },
      { word: 'transcription.', startSeconds: 2.2, endSeconds: 3.1 },
    ])
  })

  it('joins segments for the plain-text case', () => {
    expect(parseTranscriptionResponse(twoSpeakerResponse).text).toBe(
      'Hi, this is the first speaker testing transcription. And I am the second speaker. Numbers like $42 are useful.',
    )
  })

  it('reports token usage per modality, which is what COGS is computed from', () => {
    expect(parseTranscriptionResponse(twoSpeakerResponse).usage).toEqual({
      audioPromptTokens: 182,
      textPromptTokens: 44,
      outputTokens: 25,
    })
  })

  it('keeps a word whose offsets are missing rather than dropping the token', () => {
    const result = parseTranscriptionResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                text: 'first word has no offset',
                audioTranscription: {
                  text: 'first word has no offset',
                  words: [{ word: 'first' }],
                },
              },
            ],
          },
        },
      ],
    })
    expect(result.segments[0].words).toEqual([
      { word: 'first', startSeconds: null, endSeconds: null },
    ])
  })

  it('reports a null speaker label when diarization was off', () => {
    const result = parseTranscriptionResponse({
      candidates: [{ content: { parts: [{ text: 'no labels here' }] } }],
    })
    expect(result.segments[0].speakerLabel).toBeNull()
  })

  it('refuses a 200 that carries no candidates, instead of billing for silence', () => {
    expect(() => parseTranscriptionResponse({})).toThrow(/no candidates/)
  })

  it('refuses a candidate with no text', () => {
    expect(() => parseTranscriptionResponse({ candidates: [{ content: { parts: [] } }] })).toThrow(
      /no text/,
    )
  })
})

describe('secondsFromOffset', () => {
  it('accepts the proto duration strings the model returns', () => {
    expect(secondsFromOffset('1s')).toBe(1)
    expect(secondsFromOffset('0.100s')).toBe(0.1)
    expect(secondsFromOffset('-0.5s')).toBe(-0.5)
  })

  it('accepts plain numbers', () => {
    expect(secondsFromOffset(0.5)).toBe(0.5)
  })

  it('returns null for anything else', () => {
    expect(secondsFromOffset('0.600')).toBeNull()
    expect(secondsFromOffset('abc')).toBeNull()
    expect(secondsFromOffset(undefined)).toBeNull()
    expect(secondsFromOffset(Number.NaN)).toBeNull()
  })
})

describe('buildTranscriptionConfig', () => {
  it('defaults to VERBATIM and sends no capability flags', () => {
    expect(buildTranscriptionConfig()).toEqual({ mode: 'VERBATIM' })
  })

  it('is the generateContent shape, not the documented interactions shape', () => {
    const config = buildTranscriptionConfig({
      wordTimestamp: true,
      diarization: true,
      customVocabulary: ['Creative Pixels'],
      languageCodes: ['en-US'],
    })
    expect(config).toEqual({
      mode: 'VERBATIM',
      wordTimestamp: true,
      diarization: true,
      customVocabulary: ['Creative Pixels'],
      languageCodes: ['en-US'],
    })
    // The docs' nested `mode: { type: 'verbatim', ... }` is rejected by this endpoint.
    expect(typeof config.mode).toBe('string')
  })

  it('omits empty vocabulary and language lists', () => {
    expect(buildTranscriptionConfig({ customVocabulary: [], languageCodes: [] })).toEqual({
      mode: 'VERBATIM',
    })
  })

  it('refuses SMART with timestamps, which the server also refuses', () => {
    expect(() => buildTranscriptionConfig({ mode: 'SMART', wordTimestamp: true })).toThrow(
      /SMART mode cannot/,
    )
    expect(() => buildTranscriptionConfig({ mode: 'SMART', diarization: true })).toThrow(
      /SMART mode cannot/,
    )
  })

  it('allows SMART on its own', () => {
    expect(buildTranscriptionConfig({ mode: 'SMART' })).toEqual({ mode: 'SMART' })
  })
})

describe('transcribeFile', () => {
  const okFetch = () =>
    vi.fn(async () => new Response(JSON.stringify(twoSpeakerResponse), { status: 200 }))

  it('posts the file reference and config to the global model endpoint', async () => {
    const fetchImpl = okFetch()
    await transcribeFile(
      {
        fileUri: 'gs://bucket/input/0xabc/job-1/part-0.flac',
        mimeType: 'audio/flac',
        options: { wordTimestamp: true, diarization: true },
      },
      { accessToken: 'test-token', fetchImpl: fetchImpl as unknown as typeof fetch },
    )

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      'https://aiplatform.googleapis.com/v1beta1/projects/creative-ai-491118/locations/global' +
        '/publishers/google/models/gemini-3.5-transcribe:generateContent',
    )
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toEqual({
      contents: [
        {
          role: 'user',
          parts: [
            {
              fileData: {
                fileUri: 'gs://bucket/input/0xabc/job-1/part-0.flac',
                mimeType: 'audio/flac',
              },
            },
          ],
        },
      ],
      generationConfig: {
        audioTranscriptionConfig: { mode: 'VERBATIM', wordTimestamp: true, diarization: true },
      },
    })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
  })

  it('surfaces the server message on a rejected config', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                'Unable to submit request because Transcription mode SMART is incompatible with word timestamps..',
            },
          }),
          { status: 400 },
        ),
    )
    await expect(
      transcribeFile(
        { fileUri: 'gs://bucket/a.flac', mimeType: 'audio/flac' },
        { accessToken: 't', fetchImpl: fetchImpl as unknown as typeof fetch },
      ),
    ).rejects.toThrow(/Transcribe error 400: .*SMART is incompatible/)
  })
})
