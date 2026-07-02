/** Privy JWT access-token verification for Vercel serverless routes. */

import { PrivyClient } from '@privy-io/server-auth';

export { ADDRESS_REGEX, HEX_SIG_REGEX, MAX_SIG_AGE_MS } from './_address.js';

let privyClient: PrivyClient | null = null;

export function getPrivyAuth(): { appId: string; appSecret: string } | null {
  const appId = process.env.PRIVY_APP_ID?.trim() || null;
  const appSecret = process.env.PRIVY_APP_SECRET?.trim() || null;
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

function getPrivyClient(): PrivyClient | null {
  if (!privyClient) {
    const auth = getPrivyAuth();
    if (!auth) return null;
    privyClient = new PrivyClient(auth.appId, auth.appSecret);
  }
  return privyClient;
}

function isWalletWithAddress(account: unknown): account is { address: string } {
  return (
    typeof account === 'object' &&
    account !== null &&
    'address' in account &&
    typeof (account as { address: unknown }).address === 'string' &&
    (account as { address: string }).address.startsWith('0x')
  );
}

export async function verifyPrivyAccessToken(
  token: string,
  expectedAddress?: string
): Promise<{ address: `0x${string}` } | null> {
  const client = getPrivyClient();
  if (!client) return null;

  try {
    const claims = await client.verifyAuthToken(token);
    if (!claims?.userId) return null;

    const user = await client.getUserById(claims.userId);
    if (!user) return null;

    const lowerExpected = expectedAddress?.toLowerCase();
    const linkedWallets = user.linkedAccounts.filter(
      (a) => a.type === 'wallet' && isWalletWithAddress(a)
    ) as Array<{ address: string }>;

    if (!linkedWallets.length) return null;

    // If the client sent an expected active wallet, verify it is linked to this user.
    if (lowerExpected) {
      const match = linkedWallets.find(
        (w) => w.address.toLowerCase() === lowerExpected
      );
      if (!match) return null;
      return {
        address: match.address.toLowerCase() as `0x${string}`,
      };
    }

    // Fall back to the first linked wallet only when no expected address was supplied.
    return {
      address: linkedWallets[0].address.toLowerCase() as `0x${string}`,
    };
  } catch {
    return null;
  }
}

/** Extracts a Bearer token from an Authorization header. */
export function getBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
