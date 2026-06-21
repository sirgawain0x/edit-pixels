import type { InsertRecordedClipFailureReason } from '@/features/live-ai/deps/timeline-types';

export function getInsertRecordedClipErrorMessage(
  reason: InsertRecordedClipFailureReason,
): string {
  switch (reason) {
    case 'no_project':
      return 'Open a project before adding recordings to the timeline.';
    case 'import_failed':
      return 'Failed to import the recording into the media library.';
    case 'resolve_failed':
      return 'Recording imported but playback URL could not be resolved.';
    case 'no_track':
      return 'Unlock a visible track to add the recording.';
    case 'no_space':
      return 'Not enough space on the timeline—trim clips or add a track.';
    case 'build_failed':
      return 'Failed to create a timeline clip from the recording.';
    default:
      return 'Failed to add recording to timeline.';
  }
}
