/**
 * C2PA ingredient collection for export provenance.
 *
 * Maps a rendered composition's source media into the list of source assets
 * that `c2pa-web`'s Builder records as ingredients. Pure and testable — no
 * fetch/signing here (see `c2pa-sign.ts` for the network + embed boundary).
 */

import type { CompositionInputProps } from '@/types/export'
import type { TimelineItem } from '@/types/timeline'

/** Item types that represent source media (vs. text/shape/adjustment overlays). */
const MEDIA_ITEM_TYPES = new Set(['video', 'audio', 'image', 'lottie'])

function itemSrc(item: TimelineItem): string | undefined {
  return (item as { src?: string }).src
}

/**
 * Collect the unique source media items in a composition, in track order.
 * Dedupes by `src` so a clip reused across the timeline is one ingredient.
 */
export function collectIngredientSources(
  composition: CompositionInputProps,
): Array<{ title: string; src: string }> {
  const seen = new Set<string>()
  const out: Array<{ title: string; src: string }> = []

  for (const track of composition.tracks ?? []) {
    for (const item of track.items ?? []) {
      if (!MEDIA_ITEM_TYPES.has(item.type)) continue
      const src = itemSrc(item)
      if (!src || seen.has(src)) continue
      seen.add(src)
      out.push({ title: item.label || `${item.type}-${item.id}`, src })
    }
  }

  return out
}
