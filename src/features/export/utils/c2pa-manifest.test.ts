import { describe, expect, it } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import { buildC2paManifestTemplate, collectIngredientSources } from './c2pa-manifest'

function makeComposition(): CompositionInputProps {
  return {
    fps: 30,
    durationInFrames: 60,
    tracks: [
      {
        id: 't1',
        order: 0,
        items: [
          {
            id: 'v1',
            trackId: 't1',
            from: 0,
            durationInFrames: 30,
            label: 'clip-a',
            type: 'video',
            src: 'blob:a',
          },
          {
            id: 'v2',
            trackId: 't1',
            from: 30,
            durationInFrames: 30,
            label: 'clip-b',
            type: 'video',
            src: 'blob:b',
          },
          {
            id: 'txt',
            trackId: 't1',
            from: 0,
            durationInFrames: 60,
            label: 'title',
            type: 'text',
            text: 'hi',
            color: '#fff',
          },
        ],
      },
      {
        id: 't2',
        order: 1,
        items: [
          {
            id: 'v1dup',
            trackId: 't2',
            from: 0,
            durationInFrames: 30,
            label: 'clip-a-again',
            type: 'video',
            src: 'blob:a',
          },
        ],
      },
    ],
  } as unknown as CompositionInputProps
}

describe('collectIngredientSources', () => {
  it('collects unique media sources and skips non-media items', () => {
    const sources = collectIngredientSources(makeComposition())
    expect(sources.map((s) => s.src)).toEqual(['blob:a', 'blob:b'])
  })

  it('dedupes a source reused across tracks', () => {
    const sources = collectIngredientSources(makeComposition())
    expect(sources.filter((s) => s.src === 'blob:a')).toHaveLength(1)
  })
})

describe('buildC2paManifestTemplate', () => {
  it('emits the edited action assertion and claim generator', () => {
    const manifest = buildC2paManifestTemplate({
      ingredients: [{ title: 'clip-a', hash: 'sha256:abc', relationship: 'componentOf' }],
      mimeType: 'video/mp4',
    })
    expect(manifest.claimGenerator).toBe('Pixels')
    expect(manifest.format).toBe('video/mp4')
    expect(manifest.assertions).toContainEqual({
      label: 'c2pa.actions',
      data: { actions: [{ action: 'c2pa.edited' }] },
    })
    expect(manifest.ingredients).toHaveLength(1)
  })

  it('binds the wallet as a DID:ethr author when provided', () => {
    const manifest = buildC2paManifestTemplate({
      ingredients: [],
      mimeType: 'video/mp4',
      wallet: '0x1234',
    })
    expect(manifest.assertions).toContainEqual({
      label: 'stds.schema-org.CreativeWork',
      data: { author: [{ '@id': 'did:ethr:0x1234' }] },
    })
  })

  it('omits the author assertion when no wallet is provided', () => {
    const manifest = buildC2paManifestTemplate({ ingredients: [], mimeType: 'video/mp4' })
    expect(manifest.assertions.some((a) => a.label === 'stds.schema-org.CreativeWork')).toBe(false)
  })
})
