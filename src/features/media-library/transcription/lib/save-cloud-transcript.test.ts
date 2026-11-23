import { describe, expect, it, vi } from 'vitest'
import type { MediaTranscript } from '@/types/storage'
import { saveCloudTranscript } from './save-cloud-transcript'
import type { MergedCloudTranscript } from './merge-part-transcripts'

const merged: MergedCloudTranscript = {
  text: 'hello world',
  segments: [{ text: 'hello world', start: 0, end: 1.2 }],
  words: [
    { text: 'hello', start: 0, end: 0.5 },
    { text: 'world', start: 0.6, end: 1.2 },
  ],
  emptyPartIndexes: [],
}

describe('saveCloudTranscript', () => {
  it('builds the flat record the workspace persists', async () => {
    const save = vi.fn(async (transcript: MediaTranscript) => transcript)

    await saveCloudTranscript({
      mediaId: 'media-1',
      merged,
      model: 'chirp-3',
      language: 'en-US',
      now: () => 1_700_000_000_000,
      save,
    })

    expect(save).toHaveBeenCalledWith({
      id: 'media-1',
      mediaId: 'media-1',
      model: 'chirp-3',
      language: 'en-US',
      quantization: 'hybrid',
      text: 'hello world',
      segments: merged.segments,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    })
  })

  it('omits the language when none was requested, so auto-detect is not pinned', async () => {
    const save = vi.fn(async (transcript: MediaTranscript) => transcript)

    await saveCloudTranscript({ mediaId: 'media-1', merged, model: 'chirp-3', save })

    expect(save.mock.calls[0]?.[0]).not.toHaveProperty('language')
  })

  it('records the model that produced the text, which is what cache invalidation reads', async () => {
    const save = vi.fn(async (transcript: MediaTranscript) => transcript)

    await saveCloudTranscript({ mediaId: 'media-1', merged, model: 'chirp-3', save })

    expect(save.mock.calls[0]?.[0].model).toBe('chirp-3')
  })

  it('returns whatever the workspace wrote', async () => {
    const written = { ...merged, id: 'media-1' } as unknown as MediaTranscript
    const save = vi.fn(async () => written)

    await expect(
      saveCloudTranscript({ mediaId: 'media-1', merged, model: 'chirp-3', save }),
    ).resolves.toBe(written)
  })

  it('propagates a write failure rather than reporting success', async () => {
    const save = vi.fn(async () => {
      throw new Error('Failed to save transcript: media-1')
    })

    await expect(
      saveCloudTranscript({ mediaId: 'media-1', merged, model: 'chirp-3', save }),
    ).rejects.toThrow(/Failed to save transcript/)
  })
})
