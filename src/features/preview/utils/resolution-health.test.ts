import { describe, expect, it } from 'vite-plus/test'
import { hasUnresolvedMedia } from './resolution-health'
import type { TimelineTrack } from '@/types/timeline'

function tracks(items: Array<Record<string, unknown>>): TimelineTrack[] {
  return [{ id: 'track-1', type: 'video', items }] as unknown as TimelineTrack[]
}

describe('hasUnresolvedMedia', () => {
  it('is false when every media item carries a URL', () => {
    expect(
      hasUnresolvedMedia(
        tracks([
          { id: 'a', type: 'video', mediaId: 'media-1', src: 'blob:1' },
          { id: 'b', type: 'image', mediaId: 'media-2', src: 'blob:2' },
        ]),
      ),
    ).toBe(false)
  })

  it('is true when a media item resolved to an empty URL', () => {
    expect(
      hasUnresolvedMedia(
        tracks([
          { id: 'a', type: 'video', mediaId: 'media-1', src: 'blob:1' },
          { id: 'b', type: 'video', mediaId: 'media-2', src: '' },
        ]),
      ),
    ).toBe(true)
  })

  it('ignores items that never had media, so a title or a solid is not "unresolved"', () => {
    expect(
      hasUnresolvedMedia(
        tracks([
          { id: 'title', type: 'text', text: 'Hello' },
          { id: 'solid', type: 'solid', color: '#000' },
          { id: 'video', type: 'video', mediaId: 'media-1', src: 'blob:1' },
        ]),
      ),
    ).toBe(false)
  })

  it('treats a missing track list as resolved, so a first render does not retry', () => {
    expect(hasUnresolvedMedia(null)).toBe(false)
    expect(hasUnresolvedMedia(undefined)).toBe(false)
    expect(hasUnresolvedMedia([])).toBe(false)
  })
})
