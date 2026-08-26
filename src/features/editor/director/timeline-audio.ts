/**
 * Read-only timeline audio presence for Creative Director.
 * Director storyboards assume a beat-synced track already on the timeline.
 */

import { useItemsStore } from '@/features/editor/deps/timeline-store-contract'
import { useTimelineSettingsStore } from '@/features/editor/deps/timeline-store-contract'
import { hasLinkedAudioCompanion } from '@/shared/utils/linked-media'
import type { AudioItem, TimelineItem, VideoItem } from '@/types/timeline'

export interface DirectorTimelineAudioClip {
  itemId: string
  mediaId?: string
  label: string
  type: 'audio' | 'video'
  fromFrame: number
  durationInFrames: number
  durationSeconds: number
  /** Clip playback URL (blob: or https). Remote Agent Engine cannot fetch blob: URLs. */
  src: string
}

export interface DirectorTimelineAudioContext {
  hasAudio: boolean
  fps: number
  clips: DirectorTimelineAudioClip[]
  primary: DirectorTimelineAudioClip | null
}

function isAudioBearing(items: TimelineItem[], item: TimelineItem): item is AudioItem | VideoItem {
  if (item.type === 'audio') return true
  if (item.type === 'video') {
    // Dedicated audio companion already covers this video's sound.
    if (hasLinkedAudioCompanion(items, item)) return false
    return !item.embeddedAudioMuted
  }
  return false
}

function toClip(item: AudioItem | VideoItem, fps: number): DirectorTimelineAudioClip {
  const durationInFrames = Math.max(0, item.durationInFrames)
  const src = item.type === 'audio' ? item.src : item.audioSrc?.trim() || item.src
  return {
    itemId: item.id,
    mediaId: item.mediaId,
    label: item.label || (item.type === 'audio' ? 'Audio' : 'Video'),
    type: item.type,
    fromFrame: item.from,
    durationInFrames,
    durationSeconds: fps > 0 ? durationInFrames / fps : 0,
    src,
  }
}

/**
 * Snapshot of audible media currently placed on the timeline.
 * Prefers dedicated audio clips over video-with-audio for `primary`.
 */
export function buildDirectorTimelineAudioContext(
  items: TimelineItem[],
  fps: number,
): DirectorTimelineAudioContext {
  const safeFps = fps > 0 ? fps : 30
  const clips = items
    .filter((item): item is AudioItem | VideoItem => isAudioBearing(items, item))
    .map((item) => toClip(item, safeFps))
    .sort((a, b) => a.fromFrame - b.fromFrame)

  const primary =
    clips.find((clip) => clip.type === 'audio') ??
    clips.find((clip) => clip.type === 'video') ??
    null

  return {
    hasAudio: clips.length > 0,
    fps: safeFps,
    clips,
    primary,
  }
}

export function getDirectorTimelineAudioContext(): DirectorTimelineAudioContext {
  return buildDirectorTimelineAudioContext(
    useItemsStore.getState().items,
    useTimelineSettingsStore.getState().fps || 30,
  )
}

/** Appends timeline audio facts the remote Director can use without fetching blobs. */
export function formatTimelineAudioForPrompt(context: DirectorTimelineAudioContext): string {
  if (!context.hasAudio || !context.primary) {
    return [
      'Timeline audio: NONE.',
      'Do not invent a track. Ask the creator to place audio on the timeline first.',
    ].join('\n')
  }

  const lines = [
    'Timeline audio (already on the Creative Pixels timeline — use this as the beat-sync source):',
    `- Primary: "${context.primary.label}" (${context.primary.type})`,
    `- Duration: ${context.primary.durationSeconds.toFixed(2)}s (${context.primary.durationInFrames} frames @ ${context.fps} fps)`,
    `- Starts at frame ${context.primary.fromFrame}`,
  ]
  if (context.primary.mediaId) {
    lines.push(`- Media id: ${context.primary.mediaId}`)
  }
  if (context.clips.length > 1) {
    lines.push(`- Additional audible clips on timeline: ${context.clips.length - 1}`)
  }
  lines.push(
    'Storyboard timecodes must align to this timeline audio. Do not claim audio is missing.',
  )
  return lines.join('\n')
}

/** https(s) only — blob:/file: URLs are not reachable by Vertex Agent Engine. */
export function publicAudioUriForDirector(src: string | undefined): string | undefined {
  if (!src) return undefined
  if (src.startsWith('https://') || src.startsWith('http://')) return src
  return undefined
}
