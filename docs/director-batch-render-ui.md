# Director batch render UI (Phase 3)

Builds on [director-pixels-bridge.md](./director-pixels-bridge.md) Phase 2 batch quote/confirm APIs.

## Feature flag

Same as Phase 1/2:

| Variable | Where |
|----------|-------|
| `VITE_ENABLE_SEEDANCE_GENERATE` | Client — shows batch panel in Director tab |
| `SEEDANCE_GENERATE_ENABLED` | Server — batch quote/confirm + generate endpoints |

## Flow

1. Director chat produces a storyboard (≥2 parseable shots in the last assistant message).
2. **Render all shots** panel appears below the chat.
3. Client calls `POST /api/pixels-director-batch-quote` (no spend).
4. User picks render path: **Recommended mix**, **All Veo**, or **All Seedance** (optional per-shot override when ≤8 shots).
5. **Confirm & render all** → CRTVAI treasury transfer (total for selected path) → `POST /api/pixels-director-batch-confirm`.
6. Worker pool enqueues each shot via `batchConfirmId` + `shotId` + `requestId` on the listed `generateEndpoint`.
7. Poll until `video_url`; import each clip to the **media library** (not timeline — Phase 4).
8. **Retry N failed** re-enqueues only failed shots (same `requestId`; succeeded claims stay claimed).

## Concurrency

Mixed batches use **two independent worker pools** (Seedance and Veo run in parallel).

| Constant / env | Default | Applies to |
|----------------|---------|------------|
| `DIRECTOR_BATCH_SEEDANCE_CONCURRENCY_DEFAULT` | **20** | Higgsfield / Seedance only (API-key concurrency) |
| `VITE_DIRECTOR_BATCH_SEEDANCE_CONCURRENCY` | (optional) | Seedance pool override |
| `VITE_DIRECTOR_BATCH_CONCURRENCY` | (optional) | **Alias** for Seedance pool override (backward compat) |

**Veo** (Google, pay-as-you-go): **not** limited by the Higgsfield cap. All queued Veo jobs in a batch may enqueue in parallel (`resolveDirectorBatchVeoConcurrency` = batch size).

Defined in `src/features/editor/seedance/director-batch-concurrency.ts`.

## Client modules

| File | Role |
|------|------|
| `parse-storyboard-shots.ts` | Markdown → `DirectorStoryboardShotPayload[]` |
| `director-batch-queue.ts` | Path selection, retry filter, worker pool |
| `director-batch-runner.ts` | Pay → confirm → enqueue → poll → import |
| `director-batch-panel.tsx` | Director tab UI |
| `director-batch-job-store.ts` | `sessionStorage` resume for in-flight batches |
| `import-render-to-library.ts` | Library-only import (tags: `director`, `veo`/`seedance`) |

## Staging smoke

1. `VITE_ENABLE_SEEDANCE_GENERATE=1` and `SEEDANCE_GENERATE_ENABLED=1` on staging.
2. Editor → **Director** tab; timeline audio present.
3. Brief: “Storyboard a beat-synced music video” (or similar).
4. After storyboard markdown returns, confirm batch quote totals and pick a path.
5. **Confirm & render all** → watch per-shot progress → clips in media library.
6. If a shot fails, **Retry N failed** only re-runs failures.

## Out of scope

- Auto-timeline placement (Phase 4)
- Re-quoting on retry (payment already bound at confirm)
- HF keys in browser
