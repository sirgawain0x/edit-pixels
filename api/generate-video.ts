/**
 * POST /api/generate-video — submit Seedance job (credits debited server-side).
 * Header: Authorization: Bearer <privy-access-token>
 * Body: { prompt, image_urls, duration?, quality?, speed?, aspect_ratio?, generate_audio? }
 */

import { getBearerToken, verifyPrivyAccessToken } from './_wallet-auth.js';
import { debitCredits, isCreditStoreConfigured } from './_credit-store.js';
import { evolinkServerPost, isEvolinkServerConfigured } from './_evolink-server.js';

function quoteSeedanceCredits(body: Record<string, unknown>): number {
  const duration = typeof body.duration === 'number' ? body.duration : 5;
  const quality = typeof body.quality === 'string' ? body.quality : '720p';
  const speed = typeof body.speed === 'string' ? body.speed : 'standard';
  const generateAudio = body.generate_audio !== false;

  const qMult =
    quality === '1080p' ? 2.5 : quality === '720p' ? 1.6 : 1;
  const sMult = speed === 'fast' ? 0.75 : 1;
  let credits = duration * 1.4 * qMult * sMult;
  if (generateAudio) credits *= 1.15;
  return Math.max(1, Math.ceil(credits));
}

export async function POST(request: Request): Promise<Response> {
  if (!isCreditStoreConfigured() || !isEvolinkServerConfigured()) {
    return Response.json({ error: 'service unavailable' }, { status: 503 });
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

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const imageUrls = Array.isArray(body.image_urls) ? body.image_urls : [];
  if (!prompt || imageUrls.length === 0) {
    return Response.json({ error: 'prompt and image_urls required' }, { status: 400 });
  }

  const credits = quoteSeedanceCredits(body);
  const idempotencyKey = `flow-video-${auth.address.toLowerCase()}-${Date.now()}`;
  const debit = await debitCredits(auth.address, credits, idempotencyKey);
  if (!debit.ok) {
    return Response.json(
      { error: 'insufficient_credits', balance: debit.balance, creditsRequired: credits },
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

    return Response.json({ ...result, creditsDebited: credits, balance: debit.balance });
  } catch (e) {
    console.error('generate-video evolink error', e);
    return Response.json({ error: 'generation failed' }, { status: 502 });
  }
}
