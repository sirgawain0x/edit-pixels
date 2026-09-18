# Creative Pixels — generate & drop (Phase 1)

Gemini shot planning, dual render-provider CRTVAI quotes, treasury payment, and timeline drop at the playhead.

## Feature flag

When **off** (default), the editor is unchanged — no Pixels tab, API routes return `404 feature_disabled`.

| Variable | Where | Value |
|----------|-------|-------|
| `VITE_ENABLE_SEEDANCE_GENERATE` | Client (Vite) | `1` or `true` |
| `SEEDANCE_GENERATE_ENABLED` | Server (Vercel) | `1` or `true` |

## Paid path (staging / production)

On Vercel with treasury configured, billing is **enforced** unless `DIRECTOR_BILLING_SOFT=1`:

| Variable | Description |
|----------|-------------|
| `VITE_SUPERFLUID_RECEIVER` | CRTVAI treasury (or `PIXELS_TREASURY_ADDRESS`) |
| Upstash / Vercel KV | Payment anti-replay + quote/job persistence (`UPSTASH_REDIS_REST_URL` + token) |
| `HIGGSFIELD_KEY_ID` + `HIGGSFIELD_KEY_SECRET` | Higgsfield Seedance credentials (server-only) |
| `HIGGSFIELD_CREDENTIALS` | Alternative: `KEY_ID:KEY_SECRET` |
| Vertex / GCP | Same as Flow — `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION`, ADC or WIF |

**Billing flow (matches Flow/Director):**

1. `POST /api/pixels-render-quote` — server quotes stored in Redis (15 min TTL).
2. Client transfers CRTVAI to treasury via smart wallet.
3. `POST /api/seedance-generate` or `POST /api/pixels-render-veo` — verifies on-chain transfer + consumes tx hash (anti-replay).
4. On provider failure **before delivery**, payment hash is released for retry (Director pattern).
5. `settleSeedanceSpend` marks the reservation complete after successful Seedance delivery.

Credentials stay server-side only — never bundled into the browser.

## Mock / local dev

| Variable | Effect |
|----------|--------|
| `HIGGSFIELD_MOCK=1` | Skip Higgsfield; return sample MP4 |
| `HIGGSFIELD_MOCK_VIDEO_URL` | Override mock video URL |
| `DIRECTOR_BILLING_SOFT=1` | Skip on-chain CRTVAI transfer verify (balance gate only) |

Also set both feature flags to `1`. Run `gcloud auth application-default login` (or Vercel OIDC) for Gemini planning.

Soft billing is **not required** for a successful paid path on staging when treasury + KV are configured.

## User flow

1. **Plan** — `POST /api/seedance-plan` (Gemini JSON brief).
2. **Quote both** — `POST /api/pixels-render-quote` (Veo + Seedance CRTVAI estimates).
3. **Pick** — user must choose a render provider (no silent default).
4. **Pay** — CRTVAI treasury transfer when billing enforced.
5. **Generate** — `POST /api/seedance-generate` (sync Higgsfield) or `POST /api/pixels-render-veo` (async Vertex).
6. **Drop** — client imports MP4 to a new track at the playhead. **Timeline is never modified on failure or cancel.**

## Job persistence (refresh / reconnect)

| Provider | Server | Client |
|----------|--------|--------|
| **Seedance** | `pixels:generate:job:{requestId}` in Redis | `sessionStorage` + poll `GET /api/pixels-generate-task?id=` |
| **Veo** | Task registry + job record with `veoTaskId` | `sessionStorage` + poll `GET /api/generate-task?id=` |

## Errors

| Code | User impact |
|------|-------------|
| `insufficient_crtvai` | Buy CRTVAI modal; timeline unchanged |
| `payment_required` / `payment_failed` | Toast; timeline unchanged |
| `user_cancelled` | Abort during generate; timeline unchanged |
| `generation_failed` | Provider error; payment released when possible |

## Telemetry

Client emits structured `pixels_generate` wide events (provider, duration, cost estimate, outcome). No wallet addresses or prompts.

## Defaults

- Duration: 5s (Gemini may suggest 4–30s)
- Resolution: 720p (Seedance; Veo always 720p standard)
- Aspect ratio: from Gemini plan (default 16:9)

## Remaining gaps (Phase 2+)

- On-chain meToken burn (treasury transfer verify is the settlement mechanism today)
- Director-style streaming payment for long-running batch renders
