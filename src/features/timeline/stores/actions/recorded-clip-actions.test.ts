import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineTrack } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { insertRecordedClip, addMediaToTimeline } from './recorded-clip-actions';

const mediaLibraryMocks = vi.hoisted(() => ({
  importMediaWithFile: vi.fn(),
  getThumbnailBlobUrl: vi.fn(),
  loadMediaItems: vi.fn(),
  mediaItems: [] as Array<{
    id: string;
    fileName: string;
    mimeType: string;
    duration: number;
    thumbnailId: string | null;
  }>,
}));

vi.mock('@/features/timeline/deps/media-library-service', () => ({
  mediaLibraryService: {
    importMediaWithFile: mediaLibraryMocks.importMediaWithFile,
    getThumbnailBlobUrl: mediaLibraryMocks.getThumbnailBlobUrl,
  },
}));

vi.mock('@/features/timeline/deps/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: () => ({
      loadMediaItems: mediaLibraryMocks.loadMediaItems,
      mediaItems: mediaLibraryMocks.mediaItems,
    }),
  },
}));

vi.mock('@/features/timeline/deps/media-library-resolver', () => ({
  resolveMediaUrl: vi.fn(),
}));

vi.mock('@/features/timeline/deps/projects', () => ({
  useProjectStore: {
    getState: () => ({
      currentProject: {
        id: 'project-1',
        metadata: { width: 1920, height: 1080 },
      },
    }),
  },
}));

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: {
    getState: () => ({ currentFrame: 45 }),
  },
}));

vi.mock('./item-actions', () => ({
  addItem: vi.fn(),
}));

import { resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver';
import { addItem } from './item-actions';

function makeTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    type: 'video',
    order: 0,
    visible: true,
    locked: false,
    muted: false,
    isGroup: false,
    ...overrides,
  };
}

describe('insertRecordedClip', () => {
  beforeEach(() => {
    vi.mocked(mediaLibraryMocks.importMediaWithFile).mockReset();
    vi.mocked(mediaLibraryMocks.loadMediaItems).mockReset();
    vi.mocked(mediaLibraryMocks.getThumbnailBlobUrl).mockReset();
    mediaLibraryMocks.mediaItems = [];
    vi.mocked(resolveMediaUrl).mockReset();
    vi.mocked(addItem).mockReset();

    useTimelineSettingsStore.setState({ fps: 30, isDirty: false });
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([makeTrack()]);
  });

  it('returns no_project when projectId is empty', async () => {
    const result = await insertRecordedClip({
      blob: new Blob(['x'], { type: 'video/webm' }),
      durationMs: 1000,
      linkedTimelineStart: 0,
      projectId: '',
    });

    expect(result).toEqual({ ok: false, reason: 'no_project' });
  });

  it('returns no_track when all tracks are locked', async () => {
    useItemsStore.getState().setTracks([makeTrack({ locked: true })]);

    const result = await insertRecordedClip({
      blob: new Blob(['x'], { type: 'video/webm' }),
      durationMs: 1000,
      linkedTimelineStart: 0,
      projectId: 'project-1',
    });

    expect(result).toEqual({ ok: false, reason: 'no_track' });
    expect(mediaLibraryMocks.importMediaWithFile).not.toHaveBeenCalled();
  });

  it('inserts clip on the timeline on success', async () => {
    mediaLibraryMocks.importMediaWithFile.mockResolvedValue({
      id: 'media-1',
      fileName: 'ai-recording.webm',
      mimeType: 'video/webm',
      duration: 1,
      thumbnailId: null,
    });
    mediaLibraryMocks.loadMediaItems.mockResolvedValue(undefined);
    vi.mocked(resolveMediaUrl).mockResolvedValue('blob:recording');

    const result = await insertRecordedClip({
      blob: new Blob(['x'], { type: 'video/webm' }),
      durationMs: 1000,
      linkedTimelineStart: 30,
      projectId: 'project-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mediaId).toBe('media-1');
      expect(result.from).toBe(30);
      expect(result.trackId).toBe('track-1');
    }
    expect(addItem).toHaveBeenCalledOnce();
    expect(mediaLibraryMocks.loadMediaItems).toHaveBeenCalledOnce();
  });
});

describe('addMediaToTimeline', () => {
  beforeEach(() => {
    vi.mocked(resolveMediaUrl).mockReset();
    vi.mocked(addItem).mockReset();
    mediaLibraryMocks.mediaItems = [];
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false });
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([makeTrack()]);
  });

  it('returns media_not_found when media is missing', async () => {
    const result = await addMediaToTimeline('missing-id');
    expect(result).toEqual({ ok: false, reason: 'media_not_found' });
  });

  it('adds media at the playhead on success', async () => {
    mediaLibraryMocks.mediaItems = [
      {
        id: 'media-1',
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        duration: 2,
        thumbnailId: null,
      },
    ];
    vi.mocked(resolveMediaUrl).mockResolvedValue('blob:clip');

    const result = await addMediaToTimeline('media-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.from).toBe(45);
      expect(result.mediaId).toBe('media-1');
    }
    expect(addItem).toHaveBeenCalledOnce();
  });
});
