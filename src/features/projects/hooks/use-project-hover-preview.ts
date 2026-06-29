import { useState, useCallback, useRef } from 'react';
import { resolveMediaUrl } from '../deps/preview-contract';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import type { Project } from '@/types/project';

/**
 * Finds the first video item in a project's timeline that has an associated mediaId.
 * Used to determine which media source to load for the hover preview.
 */
function getFirstVideoMediaId(project: Project): string | null {
  const items = project.timeline?.items;
  if (!items) return null;
  const videoItem = items.find((item) => item.type === 'video' && item.mediaId);
  return videoItem?.mediaId ?? null;
}

/** Possible states of the hover video preview lifecycle. */
export type HoverPreviewState = 'idle' | 'loading' | 'playing' | 'ended';

/** Return value of useProjectHoverPreview. */
export interface UseProjectHoverPreviewReturn {
  previewState: HoverPreviewState;
  videoSrc: string | null;
  onMouseEnter: () => void;
  onMouseLeave: (isDragging: () => boolean) => void;
  onVideoEnded: () => void;
  onVideoError: () => void;
}

/**
 * Hook that manages fetching and playing a short hover preview video for a project card.
 *
 * On mouse enter, it resolves the first video media URL, transitions through loading/playing,
 * and cleans up the blob URL and any in-flight fetch on mouse leave or error.
 */
export function useProjectHoverPreview(project: Project): UseProjectHoverPreviewReturn {
  const [previewState, setPreviewState] = useState<HoverPreviewState>('idle');
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const mediaIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Starts loading the hover preview for the first video in the project timeline.
   * Aborts any previous fetch before starting a new one.
   */
  const onMouseEnter = useCallback(async () => {
    const mediaId = getFirstVideoMediaId(project);
    if (!mediaId) {
      setPreviewState('ended');
      return;
    }

    setPreviewState('loading');
    mediaIdRef.current = mediaId;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const url = await resolveMediaUrl(mediaId);

      if (controller.signal.aborted) {
        if (url) blobUrlManager.release(mediaId);
        return;
      }

      if (!url) {
        setPreviewState('idle');
        return;
      }

      setVideoSrc(url);
      setPreviewState('playing');
    } catch {
      if (!controller.signal.aborted) {
        setPreviewState('idle');
      }
    }
  }, [project]);

  /**
   * Cleans up the hover preview when the mouse leaves the card.
   * Skips cleanup while the user is actively dragging the scrub bar.
   */
  const onMouseLeave = useCallback((isDragging: () => boolean) => {
    if (isDragging()) return;

    abortRef.current?.abort();
    abortRef.current = null;

    if (mediaIdRef.current) {
      blobUrlManager.release(mediaIdRef.current);
      mediaIdRef.current = null;
    }

    setVideoSrc(null);
    setPreviewState('idle');
  }, []);

  /** Marks the preview as ended when the video finishes playing naturally. */
  const onVideoEnded = useCallback(() => {
    setPreviewState('ended');
  }, []);

  /** Resets the preview state and clears the video source after a playback error. */
  const onVideoError = useCallback(() => {
    setVideoSrc(null);
    setPreviewState('idle');
  }, []);

  return { previewState, videoSrc, onMouseEnter, onMouseLeave, onVideoEnded, onVideoError };
}
