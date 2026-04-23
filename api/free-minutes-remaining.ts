/**
 * Vercel serverless endpoint: returns the remaining free Live AI minutes for a wallet
 * this month. Read-only — used by UI to show "X min free remaining".
 *
 * GET query: ?address=0x...
 * Response: { minutesRemaining: number, configured: boolean }
 */

import {
  getRemainingFreeMinutes,
  isFreeTierConfigured,
} from './_free-tier-store';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export async function GET(request: Request): Promise<Response> {
  const configured = isFreeTierConfigured();
  if (!configured) {
    return Response.json({ minutesRemaining: 0, configured }, { status: 200 });
  }

  const url = new URL(request.url);
  const address = url.searchParams.get('address')?.trim();
  if (!address || !ADDRESS_REGEX.test(address)) {
    return Response.json({ error: 'invalid address' }, { status: 400 });
  }

  try {
    const minutesRemaining = await getRemainingFreeMinutes(address);
    return Response.json({ minutesRemaining, configured }, { status: 200 });
  } catch (e) {
    console.error('free-minutes-remaining error', e);
    return Response.json(
      { minutesRemaining: 0, configured, reason: 'error' },
      { status: 500 }
    );
  }
}
