/**
 * POST /api/credits-claim-membership
 * Grants the monthly Pixels Premium credit allotment to active subscribers.
 * Membership is verified on-chain (Unlock Protocol key on Arbitrum); the
 * claim is limited to once per 30 days via an atomic Redis NX key.
 * Body: { address, timestamp, nonce, signature }
 */

import {
  buildCreditsAuthMessage,
  parseWalletAuthBody,
  verifyWalletMessage,
} from './_wallet-auth.js';
import {
  addCredits,
  getCreditBalance,
  isCreditStoreConfigured,
} from './_credit-store.js';
import { getRedis } from './_redis-client.js';

/** Pixels Premium Unlock lock on Arbitrum ($30/mo). Keep in sync with src/infrastructure/unlock/membership.ts */
const PIXELS_PREMIUM_LOCK_DEFAULT =
  '0xE91BD97247fdAd39B95221BC26795a4a4A01B332' as `0x${string}`;

const CLAIM_WINDOW_SECONDS = 30 * 24 * 60 * 60;
/** Subscriber bonus Flow credits per claim (not Daydream wholesale capacity). Override via MEMBERSHIP_MONTHLY_CREDITS. */
const DEFAULT_MONTHLY_CREDITS = 100;

function getLockAddress(): `0x${string}` {
  const v =
    process.env.PIXELS_PREMIUM_LOCK_ADDRESS ||
    process.env.VITE_PIXELS_PREMIUM_LOCK_ADDRESS;
  if (v && v.startsWith('0x')) return v as `0x${string}`;
  return PIXELS_PREMIUM_LOCK_DEFAULT;
}

function getMonthlyCredits(): number {
  const raw = Number(process.env.MEMBERSHIP_MONTHLY_CREDITS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_MONTHLY_CREDITS;
}

function getArbitrumRpcUrl(): string {
  const apiKey =
    process.env.ALCHEMY_API_KEY || process.env.VITE_ALCHEMY_API_KEY;
  if (apiKey) return `https://arb-mainnet.g.alchemy.com/v2/${apiKey}`;
  return 'https://arb1.arbitrum.io/rpc';
}

export async function POST(request: Request): Promise<Response> {
  if (!isCreditStoreConfigured()) {
    return Response.json({ ok: false, reason: 'disabled' }, { status: 503 });
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

  const message = buildCreditsAuthMessage(
    'claim-membership',
    auth.address,
    auth.timestamp,
    auth.nonce
  );

  const valid = await verifyWalletMessage(auth.address, message, auth.signature);
  if (!valid) {
    return Response.json(
      { error: 'signature verification failed' },
      { status: 401 }
    );
  }

  try {
    const { createPublicClient, http, parseAbi } = await import('viem');
    const { arbitrum } = await import('viem/chains');
    const unlockHasValidKeyAbi = parseAbi([
      'function getHasValidKey(address) view returns (bool)',
    ]);

    const client = createPublicClient({
      chain: arbitrum,
      transport: http(getArbitrumRpcUrl()),
    });

    const hasKey = await client.readContract({
      address: getLockAddress(),
      abi: unlockHasValidKeyAbi,
      functionName: 'getHasValidKey',
      args: [auth.address as `0x${string}`],
    });

    if (!hasKey) {
      return Response.json(
        { ok: false, creditsGranted: 0, balance: 0, reason: 'not_member' },
        { status: 403 }
      );
    }

    const redis = await getRedis();
    if (!redis) {
      return Response.json({ ok: false, reason: 'disabled' }, { status: 503 });
    }

    const claimKey = `credits:membership-claim:${auth.address.toLowerCase()}`;
    const setOk = await redis.set(claimKey, String(Date.now()), {
      nx: true,
      ex: CLAIM_WINDOW_SECONDS,
    });
    if (!setOk) {
      const balance = await getCreditBalance(auth.address);
      return Response.json(
        { ok: false, creditsGranted: 0, balance, reason: 'already_claimed' },
        { status: 400 }
      );
    }

    const credits = getMonthlyCredits();
    const balance = await addCredits(auth.address, credits);
    return Response.json(
      { ok: true, creditsGranted: credits, balance },
      { status: 200 }
    );
  } catch (e) {
    console.error('credits-claim-membership error', e);
    return Response.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
