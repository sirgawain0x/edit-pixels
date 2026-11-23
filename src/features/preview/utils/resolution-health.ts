/**
 * Whether a resolved timeline still has media that never got a URL.
 *
 * Resolution is best-effort: an item whose bytes could not be read keeps an empty `src`, and
 * the composition simply skips it. That is the right thing to render, and the wrong thing to
 * *remember* — a boot-time hiccup (a permission prompt not yet granted, a workspace mirror
 * still being written) would otherwise leave that clip missing for the whole session.
 *
 * Only items that are supposed to have media are considered: a title or a solid has no
 * `mediaId` and is never "unresolved".
 */
import type { TimelineTrack } from '@/types/timeline'

const MEDIA_ITEM_TYPES = new Set(['video', 'audio', 'image', 'lottie'])

export function hasUnresolvedMedia(tracks: readonly TimelineTrack[] | null | undefined): boolean {
  if (!tracks) return false

  return tracks.some((track) =>
    track.items.some((item) => {
      if (!MEDIA_ITEM_TYPES.has(item.type)) return false
      const mediaId = (item as { mediaId?: string }).mediaId
      if (!mediaId) return false
      return !(item as { src?: string }).src
    }),
  )
}
