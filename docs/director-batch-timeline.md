# Director batch → timeline placement (Phase 4)

Builds on [director-batch-render-ui.md](./director-batch-render-ui.md) Phase 3 batch render.

## Feature flag

Same as Generate / Director batch:

| Variable | Where |
|----------|-------|
| `VITE_ENABLE_SEEDANCE_GENERATE` | Client |
| `SEEDANCE_GENERATE_ENABLED` | Server |

## Flow

1. Timeline audio is the **master track** (same read-only snapshot as Director briefing).
2. User confirms **Render all shots** (Phase 3).
3. On full batch success, if **Lay on timeline after all shots succeed** is checked (default **on**), clips are placed on a new video track aligned to audio. Auto-lay runs **once** per successful batch.
4. If auto-lay is off, or audio was missing at success time, use **Lay on timeline** after audio is present.
5. **Lay on timeline again** stays available after the first place (or after refresh) — each click adds another video track with the same aligned clips. Toggle crossfade before re-laying to compare cuts.
6. Clips remain fully editable (trim, move) after placement.

**Never** places on timeline when batch generate fails — placement is an explicit post-success action only.

## Timing decision

| Condition | Placement |
|-----------|-----------|
| Every shot has `startSeconds` + (`endSeconds` or `duration`) from storyboard parse | Absolute offsets from audio start (storyboard timecodes) |
| Otherwise | Sequential equal split across audio duration |
| Shots have duration hints but no starts | Sequential placement; sum of durations **scaled down** if total exceeds audio length |

Storyboard timecodes are parsed from markdown like `0:00–0:05` or `(5s)`.

Audio bounds: primary clip from `buildDirectorTimelineAudioContext` (`fromFrame` + `durationSeconds`). Placements are clamped so clips do not extend past audio end.

## Transitions

Optional **Light crossfade between cuts** (default off). When enabled, adjacent back-to-back clips get a 6-frame `crossfade` at each cut. Otherwise hard cuts.

## Client modules

| File | Role |
|------|------|
| `director-batch-timeline-timing.ts` | Pure timing math + unit tests |
| `place-director-batch-on-timeline.ts` | Resolve library media → new video track |
| `director-batch-panel.tsx` | Toggle + auto-lay / manual CTA |
| `parse-storyboard-shots.ts` | `startSeconds` / `endSeconds` from timecodes |

## Staging smoke

1. `VITE_ENABLE_SEEDANCE_GENERATE=1` on staging.
2. Place audio on timeline → Director tab → storyboard (≥2 shots).
3. Enable **Lay on timeline after all shots succeed** (default).
4. **Confirm & render all** → on success, rough cut appears on a new video track over audio.
5. Use **Lay on timeline again** with crossfade toggled to compare cuts (optional).
6. Refresh the page — **Lay on timeline again** should still work (placement payload survives job clear).
7. Confirm failed batch does **not** mutate the timeline.
