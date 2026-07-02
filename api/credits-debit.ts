/**
 * POST /api/credits-debit
 * Privy-authenticated debit for Live AI ticks or Flow jobs.
 * Header: Authorization: Bearer <privy-access-token>
 * Body: { amount, reason, idempotencyKey? }
 */

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js';
import { debitCredits, isCreditStoreConfigured } from './_credit-store.js';

const VALID_REASONS = new Set(['live_ai', 'flow_video', 'flow_image']);

export async function POST(request: Request): Promise<Response> {
  if (!isCreditStoreConfigured()) {
    return Response.json(
      { ok: false, balance: 0, reason: 'disabled' },
      { status: 503 }
    );
  }

  const token = getBearerToken(request);
  if (!token) {
    return Response.json({ error: 'missing authorization' }, { status: 401 });
  }

  const auth = await verifyPrivyAccessToken(token);
  if (!auth) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  const amount =
    typeof body.amount === 'number' ? Math.floor(body.amount) : NaN;
  const reason = typeof body.reason === 'string' ? body.reason : '';
  const idempotencyKey =
    typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined;

  if (!Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: 'invalid amount' }, { status: 400 });
  }
  if (!VALID_REASONS.has(reason)) {
    return Response.json({ error: 'invalid reason' }, { status: 400 });
  }

  try {
    const result = await debitCredits(auth.address, amount, idempotencyKey);
    if (!result.ok) {
      return Response.json(
        {
          ok: false,
          balance: result.balance,
          debited: 0,
          reason: result.reason ?? 'insufficient',
        },
        { status: 402 }
      );
    }
    return Response.json(
      { ok: true, balance: result.balance, debited: result.debited },
      { status: 200 }
    );
  } catch (e) {
    console.error('credits-debit error', e);
    return Response.json({ error: 'server error' }, { status: 500 });
  }
}
