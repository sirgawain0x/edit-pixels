# Upstream sync (walterlow/freecut)

Pixels forked from [FreeCut](https://github.com/walterlow/freecut). This document tracks selective ports — **never** merge `upstream/main` wholesale into `prod`.

## Snapshot (2026-06-12)

| Metric | Value |
|--------|-------|
| Merge base | `bb972a0b` (upstream PR #141) |
| Behind upstream | ~1,080 commits |
| Ahead of upstream | ~106 commits |
| Predicted full-merge conflicts | ~66 files |
| Rollback tag | `pixels-pre-upstream-sync-20260612` |

```bash
git remote add upstream https://github.com/walterlow/freecut.git
git fetch upstream main
```

## Protected (Pixels-only — do not overwrite)

- `src/features/live-ai/`, `generative/`, `prompt-engine/`, `credits/`
- `api/credits-*`, `api/generate-*`
- `contracts/`, Account Kit / Superfluid billing
- Branding: Pixels, `.pixels.zip`, custom Vite proxies

## Tier 1 — Port (bug fixes & UX)

| Upstream SHA | Area | Pixels decision | Status |
|--------------|------|-----------------|--------|
| `87022073` | Export GPU pool-canvas double-release | **Deferred** — fix lives in upstream `frame-compositing.ts`; Pixels still uses monolithic `client-render-engine.ts` | Watch |
| `1cde85d5` | Timeline waveform level cache races | **Deferred** — Pixels lacks display-level waveform path (`getDisplayLevel`) | Watch |
| `9581a2f9` | Full-res waveform when zoomed in | **Deferred** — needs `chooseDisplayLevelForZoom` | Watch |
| `34fd3758` | Transition overlay during playback | **Already covered** — `playback-transition-overlay.ts` + `video-preview.tsx` | Skip |
| `39f69683` | Source monitor seek thrash | **Ported** — `source-media-sync.ts` | Done |
| `52e5cce2` | Media re-import visibility | **Ported** — `ensureImportedMediaVisible` | Done |
| `1cde85d5` (partial) | Ruler tile cache key | **Ported** — `timeline-markers.tsx` `tileKeyFor` | Done |
| `493da2f5` | Audio skim + waveform preview | Port when touching preview/media | Pending |
| `63fbdc9a` | A11y + auto-save defaults | Port | Pending |

## Tier 2 — Larger features

| Feature | Decision | Status |
|---------|----------|--------|
| **i18n (9 languages)** | Adopt — see below | In progress |
| In-app render queue | Evaluate when export UX needs it | Skip |
| Headless CLI | Skip until product need | Skip |
| Audio skimming suite | Port as batch | Pending |

## Tier 3 — Skip unless strategy changes

- vite-plus / oxlint migration
- FreeCut branding / `.freecut.zip`
- Full upstream merge

---

## i18n

- Stack: `i18next`, `react-i18next`, `i18next-browser-languagedetector`
- Bootstrap: `src/i18n/index.ts` (storage key: `pixels-language`)
- Locales: `src/i18n/locales/{en,es,fr,de,pt-BR,tr,ja,ko,zh}.json` + `partials/`
- Pixels partials: `credits.json`, `live-ai.json`, `generative.json`, `billing.json`
- Switcher: projects page + editor toolbar

**Component wiring:** incremental — projects list/page wired; editor/timeline/export follow as those files are touched.

---

## Monthly sync rhythm

Run on the first week of each month (or after major upstream releases):

```bash
git fetch upstream
git merge-tree $(git merge-base prod upstream/main) prod upstream/main 2>/dev/null | grep -c '^changed in both'
```

1. Review new upstream commits in shared paths only:

```bash
git log --oneline $(git merge-base prod upstream/main)..upstream/main --no-merges \
  -- src/features/export src/features/preview src/features/timeline \
         src/features/media-library src/domain/timeline src/i18n
```

2. Triage 1–3 commits into this doc (port / skip / watch).
3. Port each on a branch `sync/upstream-<topic>` off `prod`.
4. Cite upstream SHA in PR title: `port(upstream): … (freecut@<sha>)`.
5. Run `npm run verify` before merge.

**Rules**

- Never port upstream toolchain (`vp`, oxlint) without explicit decision.
- Rebrand FreeCut → Pixels in any locale or UI string.
- When editing a component for another reason, add `useTranslation()` if it still has hardcoded strings.
- Prefer upstream commits that already use `t()` when porting fixes.

---

## Port workflow (per fix)

```bash
git checkout -b sync/upstream-<topic> prod
git show upstream/main:<path>   # inspect
# Apply minimal equivalent in Pixels
npm run test:run -- <affected tests>
npm run verify
```

## Conflict hot zones (~70 files)

- Editor shell: `editor.tsx`, `toolbar.tsx`, `media-sidebar.tsx`
- Timeline: `timeline-item/index.tsx`
- Routes, `package.json`, `vite.config.ts`, `project-bundle/*`

Strategy: read upstream diff → minimal Pixels equivalent → test → small PR.
