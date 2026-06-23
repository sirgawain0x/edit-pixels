/**
 * POST /api/credits-redeem-promo
 * Signed promo code redemption.
 * Body: { address, timestamp, nonce, signature, code }
 */

import {
  buildCreditsAuthMessage,
  parseWalletAuthBody,
  verifyWalletMessage,
} from './_wallet-auth.js';
import { isPromoStoreConfigured, redeemPromoCode } from './_promo-store.js';

const REDEEM_RATE_WINDOW_MS = 60_000;
const REDEEM_RATE_MAX = 5;

const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > REDEEM_RATE_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= REDEEM_RATE_MAX) return false;
  entry.count += 1;
  return true;
}

export async function POST(request: Request): Promise<Response> {
  if (!isPromoStoreConfigured()) {
    return Response.json(
      { ok: false, reason: 'disabled' },
      { status: 503 }
    );
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!checkRateLimit(ip)) {
    return Response.json({ error: 'rate limited' }, { status: 429 });
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

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return Response.json({ error: 'invalid code' }, { status: 400 });
  }

  const message = buildCreditsAuthMessage(
    'redeem-promo',
    auth.address,
    auth.timestamp,
    auth.nonce,
    `code: ${code.toUpperCase()}`
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
    const result = await redeemPromoCode(code, auth.address);
    if (!result.ok) {
      return Response.json(
        {
          ok: false,
          creditsGranted: 0,
          balance: result.balance,
          reason: result.reason,
        },
        { status: 400 }
      );
    }
    return Response.json(
      {
        ok: true,
        creditsGranted: result.creditsGranted,
        balance: result.balance,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error('credits-redeem-promo error', e);
    return Response.json({ error: 'server error' }, { status: 500 });
  }
}
