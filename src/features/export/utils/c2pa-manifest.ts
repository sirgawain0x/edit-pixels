/**
 * C2PA manifest building for export provenance.
 *
 * Maps a rendered composition's source media into C2PA "ingredients" and
 * produces a manifest template the signing service signs. Pure and testable —
 * no fetch/signing here (see `c2pa-sign.ts` for the network boundary).
 */

import type { CompositionInputProps } from '@/types/export'
import type { TimelineItem } from '@/types/timeline'

export interface C2paIngredient {
  title: string
  /** `sha256:<hex>` of the source bytes. */
  hash: string
  relationship: 'componentOf'
}

export interface C2paManifestTemplate {
  claimGenerator: string
  format: string
  assertions: Array<{ label: string; data: Record<string, unknown> }>
  ingredients: C2paIngredient[]
}

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

/** SHA-256 a source's bytes, returned as `sha256:<hex>`. */
export async function hashSourceBytes(src: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(src, { signal })
  if (!res.ok) throw new Error(`Failed to fetch ingredient (${res.status})`)
  const buffer = await res.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `sha256:${hex}`
}

/**
 * Build the manifest template the signing service signs.
 * `wallet` (when present) is bound as the author identity via a DID:ethr.
 */
export function buildC2paManifestTemplate(opts: {
  ingredients: C2paIngredient[]
  mimeType: string
  wallet?: string
}): C2paManifestTemplate {
  const assertions: C2paManifestTemplate['assertions'] = [
    { label: 'c2pa.actions', data: { actions: [{ action: 'c2pa.edited' }] } },
  ]

  if (opts.wallet) {
    assertions.push({
      label: 'stds.schema-org.CreativeWork',
      data: { author: [{ '@id': `did:ethr:${opts.wallet}` }] },
    })
  }

  return {
    claimGenerator: 'Pixels',
    format: opts.mimeType,
    assertions,
    ingredients: opts.ingredients,
  }
}
