/**
 * POST /api/generate-image — submit Nanobanana job.
 * Payment: checks CRTVAI meToken balance on Base (sufficient to cover the cost).
 * The actual debit happens on-chain via the user's smart wallet.
 *
 * Header: Authorization: Bearer <privy...ken>
 * Body: { prompt, quality?, size?, image_urls? }
 */

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js';
import { checkMetokenSufficient } from './_metoken-server.js';
import { evolinkServerPost, isEvolinkServerConfigured } from './_evolink-server.js';

/**
 * Quote render cost in USDC-equivalent (6 decimals).
 * Based on the legacy credit rates (~$0.10/credit).
 */
function quoteRenderCostUsdc6(quality: string): number {
  const creditMap: Record<string, number> = {
    '0.5K': 5,
    '1K': 8,
    '2K': 12,
    '4K': 18,
  };
  const credits = creditMap[quality] ?? 10;
  // $0.10 USDC per credit → usdc6 = credits * 100_000
  return credits * 100_000;
}

export async function POST(request: Request): Promise<Response> {
  if (!isEvolinkServerConfigured()) {
    return Response.json({ error: 'service unavailable' }, { status: 503 });
  }

  const token = getBearerToken(request);
  if (!token) {
    return Response.json({ error: 'missing authorization' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return Response.json({ error: 'invalid body' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  const auth = await verifyPrivyAccessToken(
    token,
    typeof body.walletAddress === 'string' ? body.walletAddress : undefined
  );
  if (!auth) {
    return Response.json({ error: 'invalid authorization' }, { status: 401 });
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
  const costUsdc6 = quoteRenderCostUsdc6(quality);

  // Gate on CRTVAI balance
  const balanceCheck = await checkMetokenSufficient(auth.address, costUsdc6);
  if (!balanceCheck.sufficient) {
    return Response.json(
      {
        error: 'insufficient_crtvai',
        balance: balanceCheck.balance.toString(),
        requiredMetoken: balanceCheck.requiredMetoken.toString(),
        costUsdc6,
      },
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

    return Response.json({
      ...result,
      costUsdc6,
      crtvaiRequired: balanceCheck.requiredMetoken.toString(),
    });
  } catch (e) {
    console.error('generate-image evolink error', e);
    return Response.json({ error: 'generation failed' }, { status: 502 });
  }
}