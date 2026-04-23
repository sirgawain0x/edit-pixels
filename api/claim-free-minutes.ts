/**
 * Vercel serverless endpoint: atomically claims 5 free Live AI minutes for a wallet
 * address within the 15 min/month allowance. Called by the billing loop before
 * falling back to on-chain payAiRender charging.
 *
 * Signature verification: requires an EIP-191 personal_sign signature over a message
 * that binds {address, timestamp, nonce}. Uses viem's publicClient.verifyMessage,
 * which supports EOAs, EIP-1271 smart contract accounts, and EIP-6492 pre-deployment
 * signatures (for brand-new smart accounts that haven't been deployed yet).
 *
 * POST body: { address, timestamp, nonce, signature }
 * Response: { ok, minutesRemaining, minutesGranted }
 */

import { createPublicClient, http } from 'viem';
import { arbitrum } from 'viem/chains';
import { claimFiveFreeMinutes, isFreeTierConfigured } from './_free-tier-store';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const HEX_SIG_REGEX = /^0x[a-fA-F0-9]+$/;
const MAX_SIG_AGE_MS = 5 * 60 * 1000;

/**
 * MESSAGE FORMAT — must stay byte-identical to src/features/live-ai/hooks/use-free-tier.ts.
 * Change here and client in the same commit.
 */
function buildFreeTierMessage(
  address: string,
  timestamp: number,
  nonce: string
): string {
  return (
    'Pixels free-tier claim\n' +
    `address: ${address.toLowerCase()}\n` +
    `timestamp: ${timestamp}\n` +
    `nonce: ${nonce}`
  );
}

function getArbitrumRpcUrl(): string {
  const apiKey =
    process.env.ALCHEMY_API_KEY || process.env.VITE_ALCHEMY_API_KEY;
  if (apiKey) return `https://arb-mainnet.g.alchemy.com/v2/${apiKey}`;
  return 'https://arb1.arbitrum.io/rpc';
}

export async function POST(request: Request): Promise<Response> {
  if (!isFreeTierConfigured()) {
    return Response.json(
      { ok: false, minutesRemaining: 0, minutesGranted: 0, reason: 'disabled' },
      { status: 200 }
    );
  }

  let address: string | undefined;
  let timestamp: number | undefined;
  let nonce: string | undefined;
  let signature: string | undefined;
  try {
    const body = (await request.json()) as {
      address?: unknown;
      timestamp?: unknown;
      nonce?: unknown;
      signature?: unknown;
    };
    if (typeof body?.address === 'string') address = body.address.trim();
    if (typeof body?.timestamp === 'number') timestamp = body.timestamp;
    if (typeof body?.nonce === 'string') nonce = body.nonce.trim();
    if (typeof body?.signature === 'string') signature = body.signature.trim();
  } catch {
    // fall through to validation error
  }

  if (!address || !ADDRESS_REGEX.test(address)) {
    return Response.json({ error: 'invalid address' }, { status: 400 });
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return Response.json({ error: 'invalid timestamp' }, { status: 400 });
  }
  if (Math.abs(Date.now() - timestamp) > MAX_SIG_AGE_MS) {
    return Response.json({ error: 'stale timestamp' }, { status: 401 });
  }
  if (!nonce || nonce.length < 8 || nonce.length > 128) {
    return Response.json({ error: 'invalid nonce' }, { status: 400 });
  }
  if (!signature || !HEX_SIG_REGEX.test(signature)) {
    return Response.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    const publicClient = createPublicClient({
      chain: arbitrum,
      transport: http(getArbitrumRpcUrl()),
    });
    const message = buildFreeTierMessage(address, timestamp, nonce);
    const valid = await publicClient.verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    if (!valid) {
      return Response.json(
        { error: 'signature verification failed' },
        { status: 401 }
      );
    }
  } catch (e) {
    console.error('claim-free-minutes verify error', e);
    return Response.json({ error: 'verification error' }, { status: 500 });
  }

  try {
    const result = await claimFiveFreeMinutes(address);
    return Response.json(result, { status: 200 });
  } catch (e) {
    console.error('claim-free-minutes error', e);
    return Response.json(
      { ok: false, minutesRemaining: 0, minutesGranted: 0, reason: 'error' },
      { status: 500 }
    );
  }
}
