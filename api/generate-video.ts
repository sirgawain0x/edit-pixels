/**
 * POST /api/generate-video — submit Seedance job.
 * Payment: checks CRTVAI meToken balance on Base (sufficient to cover the cost).
 * The actual debit happens on-chain via the user's smart wallet (sell() or
 * transfer to treasury). The server gates on balance sufficiency only.
 *
 * Header: Authorization: Bearer <privy...ken>
 * Body: { prompt, image_urls, duration?, quality?, speed?, aspect_ratio?, generate_audio? }
 */

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js';
import { checkMetokenSufficient } from './_metoken-server.js';
import { evolinkServerPost, isEvolinkServerConfigured } from './_evolink-server.js';

/**
 * Quote render cost in USDC-equivalent (6 decimals).
 * Based on the legacy credit rates (~$0.10/credit).
 * Seedance: 1.4 credits/sec base, quality/speed multipliers.
 */
function quoteRenderCostUsdc6(body: Record<string, unknown>): number {
  const duration = typeof body.duration === 'number' ? body.duration : 5;
  const quality = typeof body.quality === 'string' ? body.quality : '720p';
  const speed = typeof body.speed === 'string' ? body.speed : 'standard';
  const generateAudio = body.generate_audio !== false;

  const qMult =
    quality === '1080p' ? 2.5 : quality === '720p' ? 1.6 : 1;
  const sMult = speed === 'fast' ? 0.75 : 1;
  let credits = duration * 1.4 * qMult * sMult;
  if (generateAudio) credits *= 1.15;
  credits = Math.max(1, Math.ceil(credits));

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
  const imageUrls = Array.isArray(body.image_urls) ? body.image_urls : [];
  if (!prompt || imageUrls.length === 0) {
    return Response.json({ error: 'prompt and image_urls required' }, { status: 400 });
  }

  const requestId =
    typeof body.requestId === 'string' && body.requestId.trim().length > 0
      ? body.requestId.trim()
      : null;
  if (!requestId) {
    return Response.json({ error: 'requestId required' }, { status: 400 });
  }

  const costUsdc6 = quoteRenderCostUsdc6(body);

  // Gate on CRTVAI balance — the actual debit happens on-chain
  let balanceCheck;
  try {
    balanceCheck = await checkMetokenSufficient(auth.address, costUsdc6);
  } catch (e) {
    console.error('Failed to check meToken balance', e);
    return Response.json({ error: 'failed to verify balance' }, { status: 502 });
  }
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
    const model =
      body.speed === 'fast'
        ? 'seedance-2.0-fast-image-to-video'
        : 'seedance-2.0-image-to-video';

    const result = await evolinkServerPost<Record<string, unknown>>('/videos/generations', {
      model,
      prompt,
      image_urls: imageUrls,
      duration: body.duration ?? 5,
      quality: body.quality ?? '720p',
      aspect_ratio: body.aspect_ratio ?? 'adaptive',
      generate_audio: body.generate_audio ?? true,
    });

    return Response.json({
      ...result,
      costUsdc6,
      crtvaiRequired: balanceCheck.requiredMetoken.toString(),
    });
  } catch (e) {
    console.error('generate-video evolink error', e);
    return Response.json({ error: 'generation failed' }, { status: 502 });
  }
}