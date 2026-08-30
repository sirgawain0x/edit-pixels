import { describe, expect, it } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import { collectIngredientSources } from './c2pa-manifest'

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
