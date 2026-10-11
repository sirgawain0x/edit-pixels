# Live Style (feature-flagged)

## Flags

- Client: `VITE_ENABLE_LIVE_STYLE=true`
- Server: `LIVE_STYLE_ENABLED=true`

## Env placeholders (no secrets in repo)

| Name | Purpose |
|------|---------|
| `LIVE_STYLE_PROVIDER_URL` | StreamDiffusion / GPU host WebSocket base URL |
| `LIVE_STYLE_PROVIDER_KEY` | Provider API auth |
| `LIVE_STYLE_PAYMENT_SPENDER` | USDC `transferFrom` spender for arrears pulls |
| `LIVE_STYLE_SWEEP_SECRET` | Bearer token for `POST /api/live-style-sweep` (cron) |

## Transport

Default: binary WebSocket frames. WebRTC adapter is stubbed for hosts with UDP ingress.

## Session broker

`POST /api/live-style-session` with `action`: `create` | `meter_start` | `heartbeat` | `stop`.

Server-measured seconds; warm-up free until `meter_start`. Auto-stop on missed heartbeat (30s), cap, or failed pull.
