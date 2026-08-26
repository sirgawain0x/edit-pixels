import { describe, expect, it } from 'vitest'
import {
  buildDirectorTimelineAudioContext,
  formatTimelineAudioForPrompt,
  publicAudioUriForDirector,
} from './timeline-audio'
import type { TimelineItem } from '@/types/timeline'

function audioClip(overrides: Partial<TimelineItem> & { id: string }): TimelineItem {
  return {
    type: 'audio',
    trackId: 'a1',
    from: 0,
    durationInFrames: 300,
    label: 'Track',
    src: 'blob:http://localhost/audio',
    ...overrides,
  } as TimelineItem
}

function videoClip(overrides: Partial<TimelineItem> & { id: string }): TimelineItem {
  return {
    type: 'video',
    trackId: 'v1',
    from: 0,
    durationInFrames: 300,
    label: 'Clip',
    src: 'blob:http://localhost/video',
    ...overrides,
  } as TimelineItem
}

describe('buildDirectorTimelineAudioContext', () => {
  it('reports no audio on an empty timeline', () => {
    const ctx = buildDirectorTimelineAudioContext([], 30)
    expect(ctx.hasAudio).toBe(false)
    expect(ctx.primary).toBeNull()
  })

  it('detects dedicated audio clips as primary', () => {
    const ctx = buildDirectorTimelineAudioContext(
      [
        videoClip({ id: 'v1', from: 0 }),
        audioClip({ id: 'a1', from: 10, label: 'Song', mediaId: 'm-song' }),
      ],
      30,
    )
    expect(ctx.hasAudio).toBe(true)
    expect(ctx.primary?.itemId).toBe('a1')
    expect(ctx.primary?.durationSeconds).toBe(10)
    expect(ctx.clips).toHaveLength(2)
  })

  it('skips video when a linked audio companion exists', () => {
    const ctx = buildDirectorTimelineAudioContext(
      [
        videoClip({
          id: 'v1',
          linkedGroupId: 'g1',
          mediaId: 'm1',
        }),
        audioClip({
          id: 'a1',
          linkedGroupId: 'g1',
          mediaId: 'm1',
          label: 'Companion',
        }),
      ],
      24,
    )
    expect(ctx.clips).toHaveLength(1)
    expect(ctx.primary?.type).toBe('audio')
  })

  it('ignores muted video without companion', () => {
    const ctx = buildDirectorTimelineAudioContext(
      [videoClip({ id: 'v1', embeddedAudioMuted: true })],
      30,
    )
    expect(ctx.hasAudio).toBe(false)
  })
})

describe('formatTimelineAudioForPrompt', () => {
  it('asks the agent not to invent audio when missing', () => {
    const text = formatTimelineAudioForPrompt({
      hasAudio: false,
      fps: 30,
      clips: [],
      primary: null,
    })
    expect(text).toContain('NONE')
    expect(text).toContain('place audio on the timeline')
  })

  it('includes duration and media id for primary clip', () => {
    const text = formatTimelineAudioForPrompt({
      hasAudio: true,
      fps: 30,
      clips: [
        {
          itemId: 'a1',
          mediaId: 'm1',
          label: 'Beat',
          type: 'audio',
          fromFrame: 0,
          durationInFrames: 600,
          durationSeconds: 20,
          src: 'blob:x',
        },
      ],
      primary: {
        itemId: 'a1',
        mediaId: 'm1',
        label: 'Beat',
        type: 'audio',
        fromFrame: 0,
        durationInFrames: 600,
        durationSeconds: 20,
        src: 'blob:x',
      },
    })
    expect(text).toContain('Beat')
    expect(text).toContain('20.00s')
    expect(text).toContain('m1')
  })
})

describe('publicAudioUriForDirector', () => {
  it('only returns http(s) URIs', () => {
    expect(publicAudioUriForDirector('https://cdn.example/a.mp3')).toBe('https://cdn.example/a.mp3')
    expect(publicAudioUriForDirector('blob:http://localhost/x')).toBeUndefined()
    expect(publicAudioUriForDirector(undefined)).toBeUndefined()
  })
})
