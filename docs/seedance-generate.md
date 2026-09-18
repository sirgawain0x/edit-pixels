# Creative Pixels — generate & drop (v1)

Gemini shot planning, dual render-provider CRTVAI quotes, and timeline drop at the playhead.

## Feature flag

When **off** (default), the editor is unchanged — no Pixels tab, API routes return `404 feature_disabled`.

| Variable | Where | Value |
|----------|-------|-------|
| `VITE_ENABLE_SEEDANCE_GENERATE` | Client (Vite) | `1` or `true` |
| `SEEDANCE_GENERATE_ENABLED` | Server (Vercel) | `1` or `true` |

## Required server env (production)

| Variable | Description |
|----------|-------------|
| `HIGGSFIELD_KEY_ID` + `HIGGSFIELD_KEY_SECRET` | Higgsfield API credentials |
| `HIGGSFIELD_CREDENTIALS` | Alternative: `KEY_ID:KEY_SECRET` (used by `@higgsfield/client`) |
| Vertex / GCP | Same as Flow — `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION`, ADC or WIF |
| `VITE_SUPERFLUID_RECEIVER` | CRTVAI treasury (on-chain billing on Vercel) |

Credentials stay server-side only. They are never bundled into the browser.

## Mock / local dev without a Higgsfield key

1. Set `VITE_ENABLE_SEEDANCE_GENERATE=1` and `SEEDANCE_GENERATE_ENABLED=1`.
2. Set `HIGGSFIELD_MOCK=1` — skips Higgsfield and returns a sample MP4.
3. Optional `HIGGSFIELD_MOCK_VIDEO_URL` overrides the default sample video URL.
4. Set `DIRECTOR_BILLING_SOFT=1` to skip on-chain CRTVAI transfer verification.
5. Run `gcloud auth application-default login` (or Vercel OIDC) for Gemini planning.

## Flow

1. **Plan** — `POST /api/seedance-plan` calls Gemini (not Creative Director Agent Engine).
2. **Quote both** — `POST /api/pixels-render-quote` returns CRTVAI estimates for:
   - **Google Veo 3.1** — Gemini still + Veo image-to-video (720p standard)
   - **Higgsfield Seedance 2.5** — text-to-video at undiscounted list rates (default 5s / 720p)
3. **Pick** — user must choose a render provider (no silent default).
4. **Confirm** — user pays CRTVAI to treasury for the selected quote (when enforced).
5. **Generate** — `POST /api/pixels-render-veo` or `POST /api/seedance-generate`.
6. **Drop** — client imports the MP4 and places it on a new video track at the playhead.

## CRTVAI billing stub

`api/_seedance-billing.ts` exposes `quoteSeedanceSpend` → `reserveSeedanceSpend` → `settleSeedanceSpend`. v1 gates spend via treasury transfer verify (same as Flow/Director). Full meToken burn wiring is TODO.

## Defaults

- Duration: 5s (Gemini may suggest 4–30s)
- Resolution: 720p
- Aspect ratio: from Gemini plan (default 16:9)
