/**
 * POST /api/generate-image — submit Nanobanana job (credits debited server-side).
 * Header: Authorization: Bearer <privy-access-token>
 * Body: { prompt, quality?, size?, image_urls? }
 */

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js';
import { debitCredits, isCreditStoreConfigured } from './_credit-store.js';
import { evolinkServerPost, isEvolinkServerConfigured } from './_evolink-server.js';

function quoteNanobananaCredits(quality: string): number {
  const map: Record<string, number> = {
    '0.5K': 5,
    '1K': 8,
    '2K': 12,
    '4K': 18,
  };
  return map[quality] ?? 10;
}

export async function POST(request: Request): Promise<Response> {
  if (!isCreditStoreConfigured() || !isEvolinkServerConfigured()) {
    return Response.json({ error: 'service unavailable' }, { status: 503 });
  }

  const token = getBearerToken(request);
  if (!token) {
    return Response.json({ error: 'missing authorization' }, { status: 401 });
  }

  const auth = await verifyPrivyAccessToken(
    token,
    typeof body.walletAddress === 'string' ? body.walletAddress : undefined
  );
  if (!auth) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return Response.json({ error: 'prompt required' }, { status: 400 });
  }

  const requestId =
    typeof body.requestId === 'string' && body.requestId.trim().length > 0
      ? body.requestId.trim()
      : null;
  if (!requestId) {
    return Response.json({ error: 'requestId required' }, { status: 400 });
  }

  const quality = typeof body.quality === 'string' ? body.quality : '2K';
  const credits = quoteNanobananaCredits(quality);

  const idempotencyKey = `flow-image-${auth.address.toLowerCase()}-${requestId}`;
  const debit = await debitCredits(auth.address, credits, idempotencyKey);
  if (!debit.ok) {
    return Response.json(
      { error: 'insufficient_credits', balance: debit.balance, creditsRequired: credits },
      { status: 402 }
    );
  }

  try {
    const result = await evolinkServerPost<Record<string, unknown>>('/images/generations', {
      model: 'gemini-3.1-flash-image-preview',
      prompt,
      size: body.size ?? 'auto',
      quality,
      ...(Array.isArray(body.image_urls) && body.image_urls.length > 0
        ? { image_urls: body.image_urls }
        : {}),
    });

    return Response.json({ ...result, creditsDebited: credits, balance: debit.balance });
  } catch (e) {
    console.error('generate-image evolink error', e);
    return Response.json({ error: 'generation failed' }, { status: 502 });
  }
}
