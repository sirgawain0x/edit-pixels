/**
 * GET /api/credits-balance?address=0x...
 * Returns credit balance for a wallet.
 */

import { ADDRESS_REGEX } from './_wallet-auth';
import { getCreditBalance, isCreditStoreConfigured } from './_credit-store';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const address = url.searchParams.get('address')?.trim() ?? '';

  if (!ADDRESS_REGEX.test(address)) {
    return Response.json({ error: 'invalid address' }, { status: 400 });
  }

  if (!isCreditStoreConfigured()) {
    return Response.json(
      { balance: 0, configured: false },
      { status: 200 }
    );
  }

  try {
    const balance = await getCreditBalance(address);
    return Response.json({ balance, configured: true }, { status: 200 });
  } catch (e) {
    console.error('credits-balance error', e);
    return Response.json({ error: 'server error' }, { status: 500 });
  }
}
