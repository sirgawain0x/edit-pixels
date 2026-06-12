# Internal billing economics

Private ops reference — not user-facing. Do not expose wholesale Daydream capacity in product UI.

## Wholesale (platform operator / Daydream)

| Plan | Monthly cost | Capacity | Approx. runtime |
|------|--------------|----------|-----------------|
| Pro  | $10/mo       | 500 credits | ~7 h real-time AI |
| Max  | $30/mo       | 1,750 credits | ~23 h real-time AI |

These numbers are **your** Daydream invoice basis. They are not retail prices.

## Retail (user-facing, in app)

| Product | Price | What user gets |
|---------|-------|----------------|
| Starter credit pack | $5 USDC | 50 Flow credits |
| Pro credit pack | $15 USDC | 175 Flow credits |
| Studio credit pack | $40 USDC | 500 Flow credits |
| Pixels Premium (Unlock) | $30/mo | Premium Live AI USDC rate ($1.50/hr vs $3/hr retail) |
| Live AI streaming | USDC via Superfluid | Per-second billing; not credits |
| Membership bonus | Manual claim | `MEMBERSHIP_MONTHLY_CREDITS` (default **100** Flow credits / 30 days) |

Flow credits pay for **Flow image/video generation** only. Live AI requires **USDC streaming**.

## Margin sanity check

- Studio pack: $40 retail for 500 Flow credits vs ~$10/mo wholesale for 500 capacity → healthy markup on pack sales.
- Live AI retail $3/hr: ~7 h ≈ $21 vs $10 wholesale → margin on non-premium streaming.
- Live AI premium $1.50/hr: ~7 h ≈ $10.50 vs $10 wholesale → thin; subscription + volume matters.

Target: annual Daydream cost ÷ (pack revenue + Superfluid inflows + Unlock subscription share) ≥ 1.0 plus profit buffer.

## Production env

```bash
# Credit ledger (required for purchases)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# On-chain credit packs (Arbitrum)
VITE_ARBITRUM_PAYMENT_CONTRACT=
ARBITRUM_PAYMENT_CONTRACT=

# Subscriber Flow credit bonus — keep at 50–100, NOT wholesale 500/1750
MEMBERSHIP_MONTHLY_CREDITS=100

# Live AI USDC streaming
VITE_SUPERFLUID_RECEIVER=

# Unlock $30/mo subscription lock
VITE_PIXELS_PREMIUM_LOCK_ADDRESS=
PIXELS_PREMIUM_LOCK_ADDRESS=
```

## Pre-launch checklist

1. Redis + payment contract env vars set; on-chain packs match `src/config/credits.ts` and `api/_credit-packs.ts`.
2. Buy Starter ($5): USDC → treasury, balance +50, re-sync idempotent.
3. Buy Studio ($40): balance +500.
4. Flow generation debits quoted credits.
5. Live AI starts only after Superfluid USDC flow (not credit balance).
6. Active Unlock key: membership claim once per 30 days; second claim rejected.
7. Simulate sync failure: retry sync with same txHash credits user without double-charge.
