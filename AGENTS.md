# Pixels Web

Browser-based multi-track video editor. React 19 + TypeScript + Vite.

## Environment

- `VITE_SHOW_DEBUG_PANEL=false` hides the debug panel in dev (shown by default)

## Toolchain & dependency notes

- All production deps are exact-pinned; keep new deps exact-pinned too (no `^`/`~`). `onnxruntime-web` (dev build) and `lucide-react` (0.468.x) are pinned **deliberately** — never routine-bump either
- **Never bulk-`fallow fix`.** The `check:unused-exports` / `check:unused-class-members` allowlists are ratchet baselines, not approvals — trace per export

## Git

- `prod` — production (this is `origin/HEAD`), `staging` — pre-release integration
- Cut a feature branch off `staging` and open the PR against `staging`; `staging` is promoted to `prod`. Do **not** open PRs against `prod` directly
- Conventional commits — `type(scope): description` (e.g. `fix(timeline):`, `feat(export):`)
