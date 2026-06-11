/**
 * POST /api/credits-debit
 * Signed debit for Live AI ticks or Flow jobs.
 * Body: { address, timestamp, nonce, signature, amount, reason, idempotencyKey? }
 */

import {
  buildCreditsAuthMessage,
  parseWalletAuthBody,
  verifyWalletMessage,
} from './_wallet-auth';
import { debitCredits, isCreditStoreConfigured } from './_credit-store';

const VALID_REASONS = new Set(['live_ai', 'flow_video', 'flow_image']);

export async function POST(request: Request): Promise<Response> {
  if (!isCreditStoreConfigured()) {
    return Response.json(
      { ok: false, balance: 0, reason: 'disabled' },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  const auth = parseWalletAuthBody(body);
  if (!auth) {
    return Response.json({ error: 'invalid auth' }, { status: 400 });
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

  const message = buildCreditsAuthMessage(
    'debit',
    auth.address,
    auth.timestamp,
    auth.nonce,
    `amount: ${amount}\nreason: ${reason}`
  );

  const valid = await verifyWalletMessage(
    auth.address,
    message,
    auth.signature
  );
  if (!valid) {
    return Response.json({ error: 'signature verification failed' }, { status: 401 });
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
