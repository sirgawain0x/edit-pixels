import type { TimelinePlacementFailureReason } from '@/features/timeline/types';

export function getTimelinePlacementErrorMessage(
  reason: TimelinePlacementFailureReason,
): string {
  switch (reason) {
    case 'no_project':
      return 'Open a project before adding media to the timeline.';
    case 'media_not_found':
      return 'Media item not found. Try refreshing the library.';
    case 'unsupported_type':
      return 'This file type cannot be added to the timeline.';
    case 'import_failed':
      return 'Failed to import the media into the library.';
    case 'resolve_failed':
      return 'Media imported but playback URL could not be resolved.';
    case 'no_track':
      return 'Unlock a visible track to add media.';
    case 'no_space':
      return 'Not enough space on the timeline—trim clips or add a track.';
    case 'build_failed':
      return 'Failed to create a timeline clip from this media.';
    default:
      return 'Failed to add media to timeline.';
  }
}
