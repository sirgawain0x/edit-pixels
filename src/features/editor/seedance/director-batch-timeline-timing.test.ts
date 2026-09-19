import { describe, expect, it } from 'vitest'
import { computeDirectorBatchPlacements } from './director-batch-timeline-timing'

describe('computeDirectorBatchPlacements', () => {
  const fps = 30
  const audioStartFrame = 0
  const audioDurationSeconds = 30

  it('uses storyboard start/end when every shot has explicit timings', () => {
    const placements = computeDirectorBatchPlacements({
      shots: [
        { shotId: 'shot-1', startSeconds: 0, endSeconds: 10 },
        { shotId: 'shot-2', startSeconds: 10, endSeconds: 25 },
      ],
      audioDurationSeconds,
      audioStartFrame,
      fps,
    })

    expect(placements).toHaveLength(2)
    expect(placements[0]).toMatchObject({ shotId: 'shot-1', startFrame: 0, durationInFrames: 300 })
    expect(placements[1]).toMatchObject({ shotId: 'shot-2', startFrame: 300, durationInFrames: 450 })
  })

  it('uses startSeconds + durationSeconds in storyboard mode', () => {
    const placements = computeDirectorBatchPlacements({
      shots: [
        { shotId: 'shot-1', startSeconds: 5, durationSeconds: 4 },
        { shotId: 'shot-2', startSeconds: 12, durationSeconds: 6 },
      ],
      audioDurationSeconds,
      audioStartFrame,
      fps,
    })

    expect(placements[0]?.startFrame).toBe(150)
    expect(placements[0]?.durationInFrames).toBe(120)
    expect(placements[1]?.startFrame).toBe(360)
    expect(placements[1]?.durationInFrames).toBe(180)
  })

  it('equal-splits audio when storyboard timings are incomplete', () => {
    const placements = computeDirectorBatchPlacements({
      shots: [{ shotId: 'shot-1' }, { shotId: 'shot-2' }, { shotId: 'shot-3' }],
      audioDurationSeconds: 30,
      audioStartFrame: 0,
      fps: 30,
    })

    expect(placements).toHaveLength(3)
    expect(placements[0]?.startFrame).toBe(0)
    expect(placements[0]?.durationInFrames).toBe(300)
    expect(placements[1]?.startFrame).toBe(300)
    expect(placements[1]?.durationInFrames).toBe(300)
    expect(placements[2]?.startFrame).toBe(600)
    expect(placements[2]?.durationInFrames).toBe(300)
  })

  it('scales hinted durations when their sum exceeds audio length', () => {
    const placements = computeDirectorBatchPlacements({
      shots: [
        { shotId: 'shot-1', durationSeconds: 20 },
        { shotId: 'shot-2', durationSeconds: 20 },
      ],
      audioDurationSeconds: 20,
      audioStartFrame: 0,
      fps: 30,
    })

    expect(placements[0]?.durationInFrames).toBe(300)
    expect(placements[1]?.durationInFrames).toBe(300)
    expect(placements[1]?.startFrame).toBe(300)
  })

  it('clamps placements to audio end when storyboard exceeds audio', () => {
    const placements = computeDirectorBatchPlacements({
      shots: [{ shotId: 'shot-1', startSeconds: 25, endSeconds: 40 }],
      audioDurationSeconds: 30,
      audioStartFrame: 0,
      fps: 30,
    })

    expect(placements[0]?.startFrame).toBe(750)
    expect(placements[0]?.durationInFrames).toBe(150)
  })

  it('offsets placements by audio start frame on the timeline', () => {
    const placements = computeDirectorBatchPlacements({
      shots: [{ shotId: 'shot-1' }, { shotId: 'shot-2' }],
      audioDurationSeconds: 10,
      audioStartFrame: 90,
      fps: 30,
    })

    expect(placements[0]?.startFrame).toBe(90)
    expect(placements[1]?.startFrame).toBe(240)
  })
})
