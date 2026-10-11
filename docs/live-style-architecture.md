# Live Style (feature-flagged)

## Flags

- Client: `VITE_ENABLE_LIVE_STYLE=true`
- Server: `LIVE_STYLE_ENABLED=true`

## Env placeholders (no secrets in repo)

| Name | Purpose |
|------|---------|
| `LIVE_STYLE_PROVIDER_URL` | StreamDiffusion / GPU host WebSocket base URL |
| `LIVE_STYLE_PROVIDER_KEY` | Provider API auth (server-only; never sent to the client) |
| `LIVE_STYLE_WS_TOKEN_SECRET` | HMAC secret for short-lived WebSocket connect tokens (preferred over reusing provider key) |
| `LIVE_STYLE_PAYMENT_SPENDER` | USDC `transferFrom` spender for arrears pulls |
| `LIVE_STYLE_SWEEP_SECRET` | Bearer token for `POST /api/live-style-sweep` (cron) |
| `LIVE_STYLE_SPEND_AUTH_SOFT` | `1` skips on-chain spend-auth verification (local dev only) |

`create` requires a verified on-chain spend proof (USDC approve, Permit2, or Coinbase spend permission) before authorization is recorded. WebSocket URLs include a signed `token` query param; GPU hosts should call `verifyLiveStyleWsSessionToken` on connect. Tokens are revoked when the session stops, hits cap, or is swept.

## Transport

Default: binary WebSocket frames. WebRTC adapter is stubbed for hosts with UDP ingress.

## Session broker

`POST /api/live-style-session` with `action`: `create` | `meter_start` | `heartbeat` | `stop`.

Server-measured seconds; warm-up free until `meter_start`. Auto-stop on missed heartbeat (30s), cap, or failed pull.
