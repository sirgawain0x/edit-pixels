/**
 * Recorded Clip Actions - Import AI-recorded video blobs to media library and timeline.
 */

import type {
  AddMediaToTimelineResult,
  InsertRecordedClipParams,
  InsertRecordedClipResult,
} from '../../types';
import { useItemsStore } from '../items-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useProjectStore } from '@/features/timeline/deps/projects';
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import { resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver';
import { findNearestAvailableSpace } from '../../utils/collision-utils';
import { buildTimelineBaseItem, buildTypedTimelineItem } from '../../utils/build-timeline-item-from-media';
import { logger } from './shared';
import { addItem } from './item-actions';
import { usePlaybackStore } from '@/shared/state/playback';

/**
 * Insert a recorded Live AI clip (blob) onto the timeline.
 * 1. Imports the blob into the media library via OPFS
 * 2. Resolves blob URL and thumbnail
 * 3. Creates a video timeline item at the given position
 */
export async function insertRecordedClip(
  params: InsertRecordedClipParams,
): Promise<InsertRecordedClipResult> {
  const { blob, durationMs, linkedTimelineStart, projectId } = params;

  if (!projectId) {
    return { ok: false, reason: 'no_project' };
  }

  const tracks = useItemsStore.getState().tracks;
  const droppableTrack = tracks.find((t) => !t.isGroup && t.visible && !t.locked);
  if (!droppableTrack) {
    logger.warn('No droppable track available for recorded clip');
    return { ok: false, reason: 'no_track' };
  }

  try {
    const file = new File([blob], `ai-recording-${Date.now()}.webm`, {
      type: blob.type || 'video/webm',
    });
    const media = await mediaLibraryService.importMediaWithFile(file, projectId);

    await useMediaLibraryStore.getState().loadMediaItems();

    const blobUrl = await resolveMediaUrl(media.id);
    if (!blobUrl || blobUrl === '') {
      logger.error('Failed to resolve blob URL for recorded clip', { mediaId: media.id });
      return { ok: false, reason: 'resolve_failed' };
    }

    let thumbnailUrl: string | null = null;
    if (media.thumbnailId) {
      try {
        thumbnailUrl = await mediaLibraryService.getThumbnailBlobUrl(media.id);
      } catch {
        // Thumbnail is optional
      }
    }

    const items = useItemsStore.getState().items;
    const fps = useTimelineSettingsStore.getState().fps;
    const project = useProjectStore.getState().currentProject;
    const canvasWidth = project?.metadata.width ?? 1920;
    const canvasHeight = project?.metadata.height ?? 1080;

    const durationInFrames = Math.max(1, Math.round((durationMs / 1000) * fps));

    const proposedPosition = Math.max(0, linkedTimelineStart);
    const trackItems = items.filter((i) => i.trackId === droppableTrack.id);
    const finalPosition = findNearestAvailableSpace(
      proposedPosition,
      durationInFrames,
      droppableTrack.id,
      trackItems,
    );

    if (finalPosition === null) {
      logger.warn('No available space on track for recorded clip');
      return { ok: false, reason: 'no_space' };
    }

    const baseItem = buildTimelineBaseItem({
      media,
      mediaId: media.id,
      label: file.name,
      trackId: droppableTrack.id,
      from: finalPosition,
      durationInFrames,
      timelineFps: fps,
    });

    const timelineItem = buildTypedTimelineItem({
      baseItem,
      mediaType: 'video',
      blobUrl,
      thumbnailUrl,
      media,
      canvasWidth,
      canvasHeight,
    });

    if (!timelineItem) {
      logger.error('Failed to build timeline item for recorded clip');
      return { ok: false, reason: 'build_failed' };
    }

    addItem(timelineItem);
    logger.info('Inserted recorded AI clip onto timeline', {
      mediaId: media.id,
      trackId: droppableTrack.id,
      from: finalPosition,
      durationInFrames,
    });

    return {
      ok: true,
      mediaId: media.id,
      itemId: timelineItem.id,
      from: finalPosition,
      trackId: droppableTrack.id,
    };
  } catch (error) {
    logger.error('Failed to insert recorded clip', error);
    return { ok: false, reason: 'import_failed' };
  }
}

/**
 * Add existing media to the timeline at the playhead position.
 * Mobile-friendly alternative to drag-drop.
 */
export async function addMediaToTimeline(mediaId: string): Promise<AddMediaToTimelineResult> {
  const project = useProjectStore.getState().currentProject;
  if (!project?.id) {
    return { ok: false, reason: 'no_project' };
  }

  const media = useMediaLibraryStore.getState().mediaItems.find((m) => m.id === mediaId);
  if (!media) {
    logger.error('Media not found for addMediaToTimeline', { mediaId });
    return { ok: false, reason: 'media_not_found' };
  }

  const mimeType = media.mimeType || '';
  const mediaType = mimeType.startsWith('video/')
    ? 'video'
    : mimeType.startsWith('audio/')
      ? 'audio'
      : mimeType.startsWith('image/')
        ? 'image'
        : null;

  if (!mediaType) {
    return { ok: false, reason: 'unsupported_type' };
  }

  const tracks = useItemsStore.getState().tracks;
  const droppableTrack = tracks.find((t) => !t.isGroup && t.visible && !t.locked);
  if (!droppableTrack) {
    logger.warn('No droppable track available for media add');
    return { ok: false, reason: 'no_track' };
  }

  try {
    const fps = useTimelineSettingsStore.getState().fps;
    const canvasWidth = project.metadata.width ?? 1920;
    const canvasHeight = project.metadata.height ?? 1080;

    const blobUrl = await resolveMediaUrl(mediaId);
    if (!blobUrl || blobUrl === '') {
      logger.error('Failed to resolve blob URL', { mediaId });
      return { ok: false, reason: 'resolve_failed' };
    }

    let thumbnailUrl: string | null = null;
    if (media.thumbnailId) {
      try {
        thumbnailUrl = await mediaLibraryService.getThumbnailBlobUrl(mediaId);
      } catch {
        // Optional
      }
    }

    const items = useItemsStore.getState().items;
    const mediaDurationSec = media.duration > 0 ? media.duration : 5;
    const durationInFrames = Math.max(1, Math.round(mediaDurationSec * fps));
    const playheadFrame = usePlaybackStore.getState().currentFrame;

    const trackItems = items.filter((i) => i.trackId === droppableTrack.id);
    const finalPosition = findNearestAvailableSpace(
      Math.max(0, playheadFrame),
      durationInFrames,
      droppableTrack.id,
      trackItems,
    );
    if (finalPosition === null) {
      return { ok: false, reason: 'no_space' };
    }

    const baseItem = buildTimelineBaseItem({
      media,
      mediaId,
      label: media.fileName,
      trackId: droppableTrack.id,
      from: finalPosition,
      durationInFrames,
      timelineFps: fps,
    });

    const timelineItem = buildTypedTimelineItem({
      baseItem,
      mediaType,
      blobUrl,
      thumbnailUrl,
      media,
      canvasWidth,
      canvasHeight,
    });

    if (!timelineItem) {
      return { ok: false, reason: 'build_failed' };
    }

    addItem(timelineItem);
    logger.info('Added media to timeline', {
      mediaId,
      trackId: droppableTrack.id,
      from: finalPosition,
      durationInFrames,
    });

    return {
      ok: true,
      mediaId,
      itemId: timelineItem.id,
      from: finalPosition,
      trackId: droppableTrack.id,
    };
  } catch (error) {
    logger.error('Failed to add media to timeline', error);
    return { ok: false, reason: 'import_failed' };
  }
}
