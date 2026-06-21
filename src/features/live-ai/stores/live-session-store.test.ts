import { beforeEach, describe, expect, it } from 'vitest';
import { useLiveSessionStore } from './live-session-store';

describe('useLiveSessionStore', () => {
  beforeEach(() => {
    useLiveSessionStore.setState({
      autoAddToTimeline: true,
      recordedTakes: [],
      isRecording: false,
    });
  });

  it('defaults autoAddToTimeline to true', () => {
    expect(useLiveSessionStore.getState().autoAddToTimeline).toBe(true);
  });

  it('updates autoAddToTimeline preference', () => {
    useLiveSessionStore.getState().setAutoAddToTimeline(false);
    expect(useLiveSessionStore.getState().autoAddToTimeline).toBe(false);
  });

  it('removeLastRecordedTake drops the most recent take', () => {
    const blob = new Blob(['x'], { type: 'video/webm' });
    useLiveSessionStore.getState().addRecordedTake({
      blob,
      durationMs: 500,
      linkedTimelineStart: 0,
    });
    useLiveSessionStore.getState().addRecordedTake({
      blob,
      durationMs: 1000,
      linkedTimelineStart: 30,
    });

    useLiveSessionStore.getState().removeLastRecordedTake();

    const takes = useLiveSessionStore.getState().recordedTakes;
    expect(takes).toHaveLength(1);
    expect(takes[0]?.durationMs).toBe(500);
  });
});
