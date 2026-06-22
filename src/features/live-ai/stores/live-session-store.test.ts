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

  it('removeRecordedTake drops the specified take', () => {
    const blob = new Blob(['x'], { type: 'video/webm' });
    const take1 = {
      blob,
      durationMs: 500,
      linkedTimelineStart: 0,
    };
    const take2 = {
      blob,
      durationMs: 1000,
      linkedTimelineStart: 30,
    };
    useLiveSessionStore.getState().addRecordedTake(take1);
    useLiveSessionStore.getState().addRecordedTake(take2);

    useLiveSessionStore.getState().removeRecordedTake(take2);

    const takes = useLiveSessionStore.getState().recordedTakes;
    expect(takes).toHaveLength(1);
    expect(takes[0]?.durationMs).toBe(500);
  });
});
